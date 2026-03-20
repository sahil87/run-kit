require "download_strategy"

# Downloads release assets from private GitHub repos using HOMEBREW_GITHUB_API_TOKEN.
class GitHubPrivateReleaseDownloadStrategy < CurlDownloadStrategy
  def initialize(url, name, version, **meta)
    meta[:headers] ||= []
    token = ENV["HOMEBREW_GITHUB_API_TOKEN"]
    if token.nil? || token.empty?
      raise "HOMEBREW_GITHUB_API_TOKEN is required to install from a private repo. " \
            "Set it in your shell profile: export HOMEBREW_GITHUB_API_TOKEN=ghp_yourtoken"
    end
    meta[:headers] << "Authorization: token #{token}"
    meta[:headers] << "Accept: application/octet-stream"
    # Resolve the asset download URL via the GitHub API
    super(resolve_asset_url(url, token), name, version, **meta)
  end

  private

  def resolve_asset_url(url, token)
    # Parse: https://github.com/OWNER/REPO/releases/download/TAG/ASSET
    match = url.match(%r{github\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/(.+)})
    raise "Cannot parse GitHub release URL: #{url}" unless match

    owner, repo, tag, asset_name = match.captures
    api_url = "https://api.github.com/repos/#{owner}/#{repo}/releases/tags/#{tag}"

    require "json"
    require "open-uri"
    response = URI.parse(api_url).open(
      "Authorization" => "token #{token}",
      "Accept" => "application/vnd.github+json",
    ).read
    release = JSON.parse(response)
    asset = release["assets"]&.find { |a| a["name"] == asset_name }
    raise "Asset #{asset_name} not found in release #{tag}" unless asset

    asset["url"]
  end
end

class RunKit < Formula
  desc "Tmux session manager with web UI"
  homepage "https://github.com/wvrdz/run-kit"
  version "VERSION_PLACEHOLDER"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-darwin-arm64.tar.gz",
          using: GitHubPrivateReleaseDownloadStrategy
      sha256 "SHA_DARWIN_ARM64"
    else
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-darwin-amd64.tar.gz",
          using: GitHubPrivateReleaseDownloadStrategy
      sha256 "SHA_DARWIN_AMD64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-linux-arm64.tar.gz",
          using: GitHubPrivateReleaseDownloadStrategy
      sha256 "SHA_LINUX_ARM64"
    else
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-linux-amd64.tar.gz",
          using: GitHubPrivateReleaseDownloadStrategy
      sha256 "SHA_LINUX_AMD64"
    end
  end

  def install
    bin.install "run-kit"
  end

  test do
    assert_match "run-kit version", shell_output("#{bin}/run-kit version")
  end
end
