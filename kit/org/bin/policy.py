"""What a headless lead run may and may not do.

runners.py hands these to each agent CLI (Claude Code: --allowedTools / --disallowedTools;
opencode: a permission block in each agent file; codex: execpolicy rules), so a
scheduled or Pulse-triggered run physically cannot send email, delete data, force-push,
merge, or deploy to production. Edit to taste; keep the NEVER and NEEDS_YES lists.
"""

ALLOWED = [
    "Read", "Edit", "Write", "Glob", "Grep", "Agent", "WebFetch", "WebSearch",
    "Bash(git *)", "Bash(gh *)", "Bash(vercel *)", "Bash(npm *)", "Bash(npx *)",
    "Bash(pnpm *)", "Bash(yarn *)", "Bash(node *)", "Bash(python3 *)",
    "Bash(pytest *)", "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
    "Bash(grep *)", "Bash(find *)", "Bash(wc *)", "Bash(mkdir *)", "Bash(cp *)",
    "Bash(mv *)", "Bash(open *)", "Bash(curl *)", "Bash(echo *)", "Bash(sed *)",
    "Bash(awk *)",
]

# Never, even with approval: sending or trashing mail, destroying data or history, DNS, billing.
NEVER = [
    "mcp__claude_ai_Gmail__send_message", "mcp__claude_ai_Gmail__reply",
    "mcp__claude_ai_Gmail__forward", "mcp__claude_ai_Gmail__trash_message",
    "mcp__claude_ai_Gmail__trash_thread", "mcp__claude_ai_Gmail__mark_message_spam",
    "mcp__claude_ai_Gmail__mark_thread_spam", "mcp__claude_ai_Gmail__update_message_labels",
    "Bash(rm -rf *)", "Bash(git push --force*)", "Bash(git push -f*)",
    "Bash(git reset --hard*)", "Bash(git branch -D*)", "Bash(gh repo delete*)",
    "Bash(vercel domains*)", "Bash(vercel dns*)", "Bash(vercel billing*)",
]

# Only with the owner's yes: production deploys and merges to the main branches.
NEEDS_YES = [
    "Bash(vercel --prod*)", "Bash(vercel deploy --prod*)", "Bash(vercel promote*)",
    "Bash(vercel rollback*)", "Bash(gh pr merge*)", "Bash(git push * main*)",
    "Bash(git push * master*)", "Bash(git push * develop*)", "Bash(git merge*)",
]

# The NEVER and NEEDS_YES shell rules as command-token prefixes, for runners whose policy
# matches prefixes rather than globs (codex execpolicy rules). Each element is a token or a
# list of alternatives. Keep in step with the two lists above.
SHELL_FORBIDDEN = [
    (["rm", ["-rf", "-fr", "-Rf", "-rF"]], "Never delete data."),
    (["git", "push", ["--force", "-f", "--force-with-lease"]], "Never force-push."),
    (["git", "reset", "--hard"], "Never discard history."),
    (["git", "branch", "-D"], "Never delete branches."),
    (["gh", "repo", "delete"], "Never delete a repository."),
    (["vercel", ["domains", "dns", "billing"]], "DNS, domains and billing are the owner's."),
    (["vercel", ["--prod", "promote", "rollback"]], "Production deploys need the owner's yes."),
    (["vercel", "deploy", "--prod"], "Production deploys need the owner's yes."),
    (["gh", "pr", "merge"], "Merges need the owner's click."),
    (["git", "merge"], "Merges need the owner's click."),
    (["git", "push", ["origin", "upstream"], ["main", "master", "develop"]], "Never push to the main branches."),
]

# Shell commands that only read files. Runners confine them to the org folder and the
# entity's extra "dirs" (see runners.py): Claude Code through its working directories,
# codex through its sandbox, opencode through per-path command rules.
READ_SHELL = ["ls", "cat", "head", "tail", "grep", "find", "wc"]
