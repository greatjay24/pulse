"""Publish-through-the-API hooks for Outbox posts. outbox_send.py calls hook_for(item) after
the owner clicks Publish in Roo; with no hook, the post stays "approved, finish by hand".

Nothing here runs without that click, and nothing posts on its own: outbox_send.py only
calls a hook after sendguard has checked the signed approval for this exact content.

Status (2026-11-05): YouTube uploads now have their own Outbox kind, youtube_upload
(youtube_api.py, connected once with connect_youtube.py), which the click carries out. The
"youtube" post hook below stays a stub; queue youtube_upload instead.

TikTok (kind tiktok_post) has no hook, on purpose. The only API path on this Mac is the
Higgsfield MCP: tiktok_prepare_publish needs a Higgsfield-hosted video URL and then hands the
owner an interactive publish form (MCP Apps) to review and submit; there is no headless
publish call, and the tool's contract says agents must not submit it. A headless
`claude -p` run therefore can't finish a post. Checked 2026-11-05: tiktok_accounts lists no
connected accounts. A direct path would be TikTok's Content Posting API with an app of our
own (developer app, video.publish scope, TikTok's audit before posts can be public).

Status (2026-10-29): both hooks are stubs. hook_for() returns None until the channel's
credentials are in the Keychain AND the publish function below is implemented and tested.
Until then every post is "finish by hand", exactly as before.

YouTube (channel "youtube"): YouTube Data API v3, videos.insert (resumable upload).
  Setup:
  1. console.cloud.google.com: a project for the owner's channel; enable "YouTube Data API v3".
  2. OAuth consent screen (External), add the owner as a test user; scope
     https://www.googleapis.com/auth/youtube.upload. Create an OAuth client (Desktop app).
  3. Run the consent flow once and keep the refresh token in the Keychain as
     "youtube:<entity>" = {"client_id", "client_secret", "refresh_token"} (keyring_store.store).
  4. Apply for the API audit (YouTube API Services compliance audit). Until it passes, every
     video uploaded by an unverified project created after 2020-07-28 is locked to private.
     https://developers.google.com/youtube/v3/docs/videos/insert
  5. Upload quota is limited per project; check the Cloud Console quota page before scheduling.
  Item fields used: title, body (description), media [the video file path], link (none).

Instagram (channel "instagram"): Instagram Graph API content publishing.
  Requirements: an Instagram professional (Business or Creator) account; a Meta app with
  Instagram content-publishing permission; a long-lived access token and the IG user id.
  Media must be at a public HTTPS URL (Meta fetches it): upload to a public bucket first.
  Flow: POST /{ig-user-id}/media (image_url or video_url + caption) -> container id;
        poll the container until status_code FINISHED (video); POST /{ig-user-id}/media_publish.
  Limit: a rolling 24h cap on API-published posts (GET /{ig-user-id}/content_publishing_limit;
  Meta's docs list 50 on one page and 100 on another). Carousels count as one post.
  https://developers.facebook.com/docs/instagram-platform/content-publishing
  Keychain: "instagram:<entity>" = {"access_token", "ig_user_id"}.
"""
import json, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))


class NotConfigured(Exception):
    pass


def _creds(channel, entity):
    try:
        import keyring_store
        raw = keyring_store.fetch(f"{channel}:{entity}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None


def publish_youtube(item, creds):
    raise NotConfigured("YouTube publishing is a stub: implement videos.insert (see this file's setup notes)")


def publish_instagram(item, creds):
    raise NotConfigured("Instagram publishing is a stub: implement media + media_publish (see this file's setup notes)")


# channel -> (publish function, implemented). Flip implemented only with a tested function.
HOOKS = {
    "youtube": (publish_youtube, False),
    "instagram": (publish_instagram, False),
}


def hook_for(item):
    """A callable(item) -> {"link": <published URL>} for this post, or None (finish by hand)."""
    if item.get("kind") != "post":
        return None
    fn, implemented = HOOKS.get(item.get("channel"), (None, False))
    if not fn or not implemented:
        return None
    creds = _creds(item["channel"], item.get("entity"))
    if not creds:
        return None
    return lambda it: fn(it, creds)


def status():
    """For docs and checks: what each channel would do on the click."""
    out = {}
    for ch, (_, implemented) in HOOKS.items():
        out[ch] = "api" if implemented else "by hand (stub)"
    return out
