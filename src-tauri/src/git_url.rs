//! Git remote URL parser — understands HTTPS, SSH, and ssh:// schemes.
//!
//! The parser is deliberately permissive about host names so that
//! self-hosted Gitea / Forgejo instances work out of the box.

/// A successfully parsed remote URL.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedGitUrl {
    /// Original string passed to `parse_git_url`.
    pub raw: String,
    /// Host name, e.g. `github.com`, `gitlab.com`, `gitea.example.com`.
    pub host: String,
    /// User or organisation, e.g. `octocat`.
    pub owner: String,
    /// Repository name **without** any trailing `.git`, e.g. `Hello-World`.
    pub repo: String,
    /// `true` for `git@…` and `ssh://…` URLs.
    pub is_ssh: bool,
}

/// Parse a git remote URL into its constituent parts.
///
/// Returns `None` for obviously invalid input (empty string, bare hostname,
/// no path segments, etc.).
///
/// # Supported shapes
///
/// | Shape | Example |
/// |-------|---------|
/// | HTTPS with .git | `https://github.com/owner/repo.git` |
/// | HTTPS without .git | `https://github.com/owner/repo` |
/// | SCP (git@) | `git@github.com:owner/repo.git` |
/// | ssh:// | `ssh://git@github.com/owner/repo.git` |
/// | Multi-level GitLab | `https://gitlab.com/group/sub/repo.git` |
/// | Custom host | `https://gitea.example.com/owner/repo.git` |
pub fn parse_git_url(url: &str) -> Option<ParsedGitUrl> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    // ── SCP-style: git@github.com:owner/repo.git ──────────────────────
    if !url.contains("://") {
        if let Some(at_pos) = url.find('@') {
            let after_at = &url[at_pos + 1..];
            if let Some(colon_pos) = after_at.find(':') {
                let host = after_at[..colon_pos].to_string();
                let path = &after_at[colon_pos + 1..];
                if host.is_empty() || path.is_empty() {
                    return None;
                }
                let (owner, repo) = split_owner_repo(path)?;
                return Some(ParsedGitUrl {
                    raw: url.to_string(),
                    host,
                    owner,
                    repo,
                    is_ssh: true,
                });
            }
        }
        return None; // Not a valid URL shape we handle
    }

    // ── URL-scheme forms ───────────────────────────────────────────────
    let scheme_end = url.find("://")?;
    let scheme = &url[..scheme_end];
    let rest = &url[scheme_end + 3..]; // everything after "://"

    let is_ssh = matches!(scheme, "ssh" | "git");

    // Strip optional `user@` prefix from the authority.
    let rest = if let Some(at) = rest.find('@') {
        // Only strip user@ if @ appears before the first /
        let slash_pos = rest.find('/').unwrap_or(usize::MAX);
        if at < slash_pos {
            &rest[at + 1..]
        } else {
            rest
        }
    } else {
        rest
    };

    // Split off the host (everything up to the first /).
    let slash = rest.find('/')?;
    let host = rest[..slash].to_string();
    let path = &rest[slash + 1..];

    if host.is_empty() || path.is_empty() {
        return None;
    }

    // Validate that the scheme is one we know about.
    match scheme {
        "https" | "http" | "ssh" | "git" => {}
        _ => return None,
    }

    let (owner, repo) = split_owner_repo(path)?;

    Some(ParsedGitUrl {
        raw: url.to_string(),
        host,
        owner,
        repo,
        is_ssh,
    })
}

/// Extract the owner and repo from a URL path segment.
///
/// The path may have multiple components (GitLab groups); the last segment
/// is the repo name and the second-to-last is the owner. Strips a trailing
/// `.git` suffix from the repo name.
fn split_owner_repo(path: &str) -> Option<(String, String)> {
    // Remove trailing slashes and .git.
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return None;
    }

    let repo = segments.last()?.to_string();
    // For multi-level GitLab paths, owner is the segment before the repo.
    let owner = segments[segments.len() - 2].to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner, repo))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn p(url: &str) -> ParsedGitUrl {
        parse_git_url(url).unwrap_or_else(|| panic!("expected Ok for {url:?}"))
    }

    #[test]
    fn https_with_dot_git() {
        let r = p("https://github.com/owner/repo.git");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(!r.is_ssh);
    }

    #[test]
    fn https_without_dot_git() {
        let r = p("https://github.com/owner/repo");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(!r.is_ssh);
    }

    #[test]
    fn scp_style_ssh() {
        let r = p("git@github.com:owner/repo.git");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(r.is_ssh);
    }

    #[test]
    fn ssh_scheme() {
        let r = p("ssh://git@github.com/owner/repo.git");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(r.is_ssh);
    }

    #[test]
    fn gitlab_multi_level_path() {
        let r = p("https://gitlab.com/group/subgroup/repo.git");
        assert_eq!(r.host, "gitlab.com");
        // owner is the segment immediately before the repo
        assert_eq!(r.owner, "subgroup");
        assert_eq!(r.repo, "repo");
        assert!(!r.is_ssh);
    }

    #[test]
    fn bitbucket_https() {
        let r = p("https://bitbucket.org/owner/repo.git");
        assert_eq!(r.host, "bitbucket.org");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(!r.is_ssh);
    }

    #[test]
    fn custom_host_gitea() {
        let r = p("https://gitea.example.com/owner/repo.git");
        assert_eq!(r.host, "gitea.example.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(!r.is_ssh);
    }

    #[test]
    fn https_no_dot_git_gitlab() {
        let r = p("https://gitlab.com/owner/repo");
        assert_eq!(r.host, "gitlab.com");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
    }

    #[test]
    fn scp_style_bitbucket() {
        let r = p("git@bitbucket.org:owner/repo.git");
        assert_eq!(r.host, "bitbucket.org");
        assert_eq!(r.owner, "owner");
        assert_eq!(r.repo, "repo");
        assert!(r.is_ssh);
    }

    #[test]
    fn http_scheme() {
        let r = p("http://gitea.internal.company.com/team/project.git");
        assert_eq!(r.host, "gitea.internal.company.com");
        assert_eq!(r.repo, "project");
        assert!(!r.is_ssh);
    }

    // ── Rejection tests ───────────────────────────────────────────────

    #[test]
    fn empty_string_is_none() {
        assert!(parse_git_url("").is_none());
    }

    #[test]
    fn plain_word_is_none() {
        assert!(parse_git_url("not a url").is_none());
    }

    #[test]
    fn bare_http_is_none() {
        assert!(parse_git_url("http://").is_none());
    }

    #[test]
    fn https_no_path_is_none() {
        assert!(parse_git_url("https://github.com").is_none());
    }

    #[test]
    fn https_only_one_segment_is_none() {
        assert!(parse_git_url("https://github.com/onlyone").is_none());
    }
}
