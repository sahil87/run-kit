package codeserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	// Repo is the upstream code-server repository releases are resolved from.
	Repo = "coder/code-server"
	// defaultAPIBase is the GitHub REST API origin (the Installer's APIBase
	// overrides it — tests point at httptest).
	defaultAPIBase = "https://api.github.com"
	// resolveTimeout bounds the release-listing API call.
	resolveTimeout = 10 * time.Second
	// downloadTimeout bounds the tarball transfer — network-transfer-sized for
	// a ~100MB asset on a slow link (an upper bound on failure, not an
	// expected duration).
	downloadTimeout = 15 * time.Minute
)

// Release is a resolved code-server release: the version plus the standalone
// tarball asset matching the host platform.
type Release struct {
	// Version is the release version with no leading "v" (e.g. "4.132.0").
	Version string
	// AssetName is the matched tarball asset filename.
	AssetName string
	// AssetURL is the asset's browser_download_url.
	AssetURL string
	// Digest is the asset's SHA256 hex digest. Unlike the desktop installer,
	// an empty digest is a HARD failure for code-server (R3): there is no
	// codesign second gate, so the release digest is the only verification —
	// an unverified binary is never activated (Constitution I posture).
	Digest string
}

// ghAsset / ghRelease decode the subset of the GitHub releases API this
// package consumes. Unknown fields are tolerated. No GitHub client library —
// net/http + encoding/json only (the desktop package precedent).
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

// platformLabels maps a GOOS/GOARCH pair onto the release tarball's asset
// labels (code-server-<ver>-<os>-<arch>.tar.gz): darwin publishes as "macos";
// linux and the two supported archs pass through.
func platformLabels(goos, goarch string) (string, string, error) {
	osLabel := goos
	if goos == "darwin" {
		osLabel = "macos"
	}
	if (osLabel != "macos" && osLabel != "linux") || (goarch != "amd64" && goarch != "arm64") {
		return "", "", fmt.Errorf("unsupported platform %s/%s — standalone code-server tarballs are published for linux and macos (amd64, arm64) only", goos, goarch)
	}
	return osLabel, goarch, nil
}

// platformAssetName builds the exact asset name for a version + platform.
func platformAssetName(version, goos, goarch string) (string, error) {
	osLabel, archLabel, err := platformLabels(goos, goarch)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("code-server-%s-%s-%s.tar.gz", version, osLabel, archLabel), nil
}

// parseSHA256Digest extracts the hex digest from a GitHub asset digest value
// ("sha256:<hex>"). Absent or non-sha256 values yield "" — for code-server
// that is a hard install failure (R3), unlike the desktop package where
// codesign stays a second gate.
func parseSHA256Digest(d string) string {
	if hex, ok := strings.CutPrefix(d, "sha256:"); ok {
		return hex
	}
	return ""
}

// resolveLatest queries the GitHub releases API for the latest release and
// selects the standalone tarball asset for the host platform. Unauthenticated
// (public repo; acquisition is rare enough that rate limits are irrelevant).
// The digest field is captured verbatim — Install refuses a missing digest.
func (ins *Installer) resolveLatest(ctx context.Context) (Release, error) {
	// The version is unknown before the API call; platformLabels validates the
	// host platform up front so an unsupported one errors before any request.
	if _, _, err := platformLabels(ins.GOOS, ins.GOARCH); err != nil {
		return Release{}, err
	}

	endpoint := ins.APIBase + "/repos/" + Repo + "/releases/latest"
	reqCtx, cancel := context.WithTimeout(ctx, resolveTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := ins.Client.Do(req)
	if err != nil {
		return Release{}, fmt.Errorf("querying GitHub releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("GitHub API returned HTTP %d for %s", resp.StatusCode, endpoint)
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return Release{}, fmt.Errorf("decoding GitHub release response: %w", err)
	}
	version := strings.TrimPrefix(rel.TagName, "v")
	if version == "" {
		return Release{}, fmt.Errorf("latest release in %s carries no tag", Repo)
	}

	want, err := platformAssetName(version, ins.GOOS, ins.GOARCH)
	if err != nil {
		return Release{}, err
	}
	for _, a := range rel.Assets {
		if a.Name == want {
			return Release{
				Version:   version,
				AssetName: a.Name,
				AssetURL:  a.BrowserDownloadURL,
				Digest:    parseSHA256Digest(a.Digest),
			}, nil
		}
	}
	return Release{}, fmt.Errorf("release %s has no %s asset", rel.TagName, want)
}
