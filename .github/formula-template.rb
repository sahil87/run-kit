require "download_strategy"

class RunKit < Formula
  desc "Tmux session manager with web UI"
  homepage "https://github.com/wvrdz/run-kit"
  version "VERSION_PLACEHOLDER"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-darwin-arm64.tar.gz",
          using: GitHubPrivateRepositoryReleaseDownloadStrategy
      sha256 "SHA_DARWIN_ARM64"
    else
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-darwin-amd64.tar.gz",
          using: GitHubPrivateRepositoryReleaseDownloadStrategy
      sha256 "SHA_DARWIN_AMD64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-linux-arm64.tar.gz",
          using: GitHubPrivateRepositoryReleaseDownloadStrategy
      sha256 "SHA_LINUX_ARM64"
    else
      url "https://github.com/wvrdz/run-kit/releases/download/v#{version}/run-kit-linux-amd64.tar.gz",
          using: GitHubPrivateRepositoryReleaseDownloadStrategy
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
