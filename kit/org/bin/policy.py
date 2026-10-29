"""What a headless lead run may and may not do.

nightly.py and act.py pass these to `claude -p` as --allowedTools / --disallowedTools, so a
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
