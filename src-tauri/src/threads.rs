// ==========================================
// Email threads: the whole conversation behind an email item, read-only
// ==========================================
// ~/portfolio/bin/email_thread.py does the reading (Gmail API or IMAP with EXAMINE + BODY.PEEK,
// so nothing is marked read, moved or archived) and the sanitizing (no scripts, forms, frames, or
// remote images unless the owner taps Load images). This module only validates what the UI asks
// for and runs the script through the same fixed-interpreter path as the Outbox scripts.

use crate::ops::{is_outbox_id, run_script_async};
use std::time::Duration;

const THREAD_TIMEOUT: Duration = Duration::from_secs(45);

fn is_account(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

// A Message-ID (with or without <>), a Gmail hex thread id, or an X-GM-THRID.
fn is_message_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 400
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '"' | '\'' | '`' | '\\' | ';' | '|' | '&' | '$'))
}

fn is_gmail_link(s: &str) -> bool {
    s.starts_with("https://mail.google.com/") && s.len() <= 1000 && !s.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// The script's arguments for one request, or why it was refused.
pub(crate) fn thread_args(
    outbox: Option<&str>,
    link: Option<&str>,
    account: Option<&str>,
    id: Option<&str>,
    images: bool,
) -> Result<Vec<String>, String> {
    let mut args = match (outbox, link, account, id) {
        (Some(o), None, None, None) if is_outbox_id(o) => vec!["--outbox".into(), o.into()],
        (None, Some(l), None, None) if is_gmail_link(l) => vec!["--link".into(), l.into()],
        (None, None, Some(a), Some(i)) if is_account(a) && is_message_ref(i) => {
            vec!["--account".into(), a.into(), "--id".into(), i.into()]
        }
        _ => return Err("Ask for one thread: an Outbox draft, a Gmail link, or an account and message id".into()),
    };
    if images {
        args.push("--images".into());
    }
    Ok(args)
}

#[tauri::command]
pub async fn read_email_thread(
    outbox: Option<String>,
    link: Option<String>,
    account: Option<String>,
    id: Option<String>,
    images: Option<bool>,
) -> Result<String, String> {
    let args = thread_args(outbox.as_deref(), link.as_deref(), account.as_deref(), id.as_deref(), images.unwrap_or(false))?;
    let v = run_script_async("email_thread.py", args, None, THREAD_TIMEOUT).await?;
    Ok(v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_source_per_request() {
        assert_eq!(thread_args(Some("20261031-010413-ayson-re-x-238c"), None, None, None, false).unwrap(),
                   ["--outbox", "20261031-010413-ayson-re-x-238c"]);
        let link = "https://mail.google.com/mail/u/?authuser=a@b.com#search/rfc822msgid:x@y.z";
        assert_eq!(thread_args(None, Some(link), None, None, true).unwrap(), ["--link", link, "--images"]);
        assert_eq!(thread_args(None, None, Some("visuo"), Some("<ab+c=@mail.gmail.com>"), false).unwrap(),
                   ["--account", "visuo", "--id", "<ab+c=@mail.gmail.com>"]);
        assert!(thread_args(None, None, None, None, false).is_err());
        assert!(thread_args(Some("20261031-a-b"), Some(link), None, None, false).is_err());
    }

    #[test]
    fn refuses_bad_input() {
        assert!(thread_args(Some("../../etc/passwd"), None, None, None, false).is_err());
        assert!(thread_args(Some("A_B"), None, None, None, false).is_err());
        assert!(thread_args(None, Some("https://evil.example/mail.google.com/"), None, None, false).is_err());
        assert!(thread_args(None, Some("https://mail.google.com/x y"), None, None, false).is_err());
        assert!(thread_args(None, None, Some("Visuo"), Some("a@b"), false).is_err());
        assert!(thread_args(None, None, Some("visuo"), Some("--images"), false).is_err());
        assert!(thread_args(None, None, Some("visuo"), Some("a@b;rm"), false).is_err());
        assert!(thread_args(None, None, Some("visuo"), Some(""), false).is_err());
        assert!(thread_args(None, None, Some("visuo"), None, false).is_err());
    }
}
