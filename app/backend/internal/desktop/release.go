package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Release is a resolved desktop-app release: the version plus the DMG asset
// matching the host architecture.
type Release struct {
	// Version is the release version with no leading "v" (e.g. "3.13.0").
	Version string
	// AssetName is the matched DMG asset filename.
	AssetName string
	// AssetURL is the asset's browser_download_url.
	AssetURL string
	// Digest is the asset's SHA256 hex digest when the API supplied one
	// ("" when absent or a non-sha256 algorithm — the checksum step is then
	// skipped and codesign remains the hard verification gate).
	Digest string
}

// ghAsset / ghRelease decode the subset of the GitHub releases API this
// package consumes. Unknown fields are tolerated. No GitHub client library —
// net/http + encoding/json only (intake § Impact: no new dependencies).
type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	// Digest is "sha256:<hex>" when GitHub computed one for the upload.
	Digest string `json:"digest"`
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

// archLabel maps a runtime.GOARCH value onto the DMG artifact arch label
// (mirroring electron-builder's ${arch} naming: arm64 → arm64, amd64 → x64).
func archLabel(goarch string) (string, error) {
	switch goarch {
	case "arm64":
		return "arm64", nil
	case "amd64":
		return "x64", nil
	default:
		return "", fmt.Errorf("unsupported architecture %q — desktop DMGs are published for arm64 and x64 only", goarch)
	}
}

// normalizeReleaseTag maps a user-supplied --version value onto the repo's
// v-prefixed tag convention: a bare semver ("3.12.2") gains the "v"; anything
// already prefixed (or non-numeric) passes through untouched.
func normalizeReleaseTag(tag string) string {
	if tag != "" && tag[0] >= '0' && tag[0] <= '9' {
		return "v" + tag
	}
	return tag
}

// ResolveRelease queries the GitHub releases API for the latest release (tag
// == "") or a specific tag, and selects the DMG asset for the host
// architecture. Unauthenticated by default (public repo); Token is sent purely
// for rate-limit headroom. A 403/429 produces the explicit rate-limit error
// the intake requires.
func (ins *Installer) ResolveRelease(ctx context.Context, tag string) (Release, error) {
	label, err := archLabel(ins.Arch)
	if err != nil {
		return Release{}, err
	}

	endpoint := ins.APIBase + "/repos/" + ins.Repo + "/releases/latest"
	if tag != "" {
		tag = normalizeReleaseTag(tag)
		endpoint = ins.APIBase + "/repos/" + ins.Repo + "/releases/tags/" + url.PathEscape(tag)
	}

	reqCtx, cancel := context.WithTimeout(ctx, apiTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if ins.Token != "" {
		req.Header.Set("Authorization", "Bearer "+ins.Token)
	}

	resp, err := ins.Client.Do(req)
	if err != nil {
		return Release{}, fmt.Errorf("querying GitHub releases: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// fall through to decode
	case http.StatusForbidden, http.StatusTooManyRequests:
		return Release{}, fmt.Errorf(
			"GitHub API request denied (HTTP %d) — likely the unauthenticated rate limit (60 requests/hour per IP); run `gh auth login` or set GITHUB_TOKEN for more headroom",
			resp.StatusCode)
	case http.StatusNotFound:
		if tag != "" {
			return Release{}, fmt.Errorf("release %s not found in %s", tag, ins.Repo)
		}
		return Release{}, fmt.Errorf("no releases found in %s", ins.Repo)
	default:
		return Release{}, fmt.Errorf("GitHub API returned HTTP %d for %s", resp.StatusCode, endpoint)
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return Release{}, fmt.Errorf("decoding GitHub release response: %w", err)
	}

	suffix := "-" + label + ".dmg"
	for _, a := range rel.Assets {
		if strings.HasPrefix(a.Name, assetPrefix) && strings.HasSuffix(a.Name, suffix) {
			return Release{
				Version:   strings.TrimPrefix(rel.TagName, "v"),
				AssetName: a.Name,
				AssetURL:  a.BrowserDownloadURL,
				Digest:    parseSHA256Digest(a.Digest),
			}, nil
		}
	}
	return Release{}, fmt.Errorf("release %s has no %s DMG asset (looked for %s*%s)", rel.TagName, label, assetPrefix, suffix)
}

// parseSHA256Digest extracts the hex digest from a GitHub asset digest value
// ("sha256:<hex>"). Absent or non-sha256 values yield "" — the checksum step
// is skipped for those (codesign stays the hard gate).
func parseSHA256Digest(d string) string {
	if hex, ok := strings.CutPrefix(d, "sha256:"); ok {
		return hex
	}
	return ""
}
