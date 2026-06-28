class_name SocialHubModel
extends RefCounted

const ANNOUNCEMENTS: Array[Dictionary] = [
	{"id": "announce_architecture", "label_key": "screen.social.announcement", "title": "Nakama business + C++ battle split", "priority": "system", "unread": true, "starts_at": "2026-06-27", "cta": "Read plan"},
	{"id": "announce_certification", "label_key": "screen.social.announcement", "title": "Certification season 0 drills", "priority": "event", "unread": true, "starts_at": "2026-06-27", "cta": "Enter certification"},
	{"id": "announce_world_boss", "label_key": "screen.social.announcement", "title": "World Boss prototype party window", "priority": "event", "unread": false, "starts_at": "2026-06-27", "cta": "View boss modes"},
]
const FRIENDS: Array[Dictionary] = [
	{"id": "friend_lumen", "display_name": "Lumen", "status": "online", "mode": "practice", "presence": "Practice lobby", "party_size": 1},
	{"id": "friend_rin", "display_name": "Rin", "status": "matching", "mode": "certification", "presence": "Certification queue", "party_size": 1},
	{"id": "friend_kai", "display_name": "Kai", "status": "offline", "mode": "-", "presence": "Offline", "party_size": 0},
]
const SOCIAL_LINKS: Array[Dictionary] = [
	{"id": "link_discord", "label_key": "screen.social.link", "title": "Discord", "url": "https://discord.gg/phantasm-klash", "kind": "community", "channel": "community", "description": "chat and party finder"},
	{"id": "link_steam", "label_key": "screen.social.link", "title": "Steam wishlist", "url": "https://store.steampowered.com/app/phantasm-klash", "kind": "promotion", "channel": "store", "description": "wishlist and news"},
	{"id": "link_creator_program", "label_key": "screen.social.link", "title": "Creator program", "url": "https://spellkard.example.com/creator", "kind": "promotion", "channel": "creator", "description": "promo link and creator code"},
	{"id": "link_github", "label_key": "screen.social.link", "title": "GitHub", "url": "https://github.com/Phantasm-Klash", "kind": "open_source", "channel": "source", "description": "open-source repositories"},
]

var selected_friend_id := ""
var last_opened_link_id := ""
var invite_requests: Array[Dictionary] = []
var dismissed_announcements: Dictionary = {}

func announcement_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for item in ANNOUNCEMENTS:
		var row := item.duplicate(true)
		row["enabled"] = not bool(dismissed_announcements.get(String(row.get("id", "")), false))
		row["ui_action"] = "dismiss_announcement"
		row["value"] = "%s | %s" % [String(row.get("priority", "")), String(row.get("starts_at", ""))]
		row["summary"] = "%s - %s" % [String(row.get("title", "")), String(row.get("cta", ""))]
		rows.append(row)
	return rows

func friend_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for item in FRIENDS:
		var row := item.duplicate(true)
		row["label_key"] = "screen.social.friend"
		row["selected"] = String(row.get("id", "")) == selected_friend_id
		row["enabled"] = String(row.get("status", "")) != "offline"
		row["ui_action"] = "invite_friend"
		row["value"] = "%s | %s" % [String(row.get("status", "")), String(row.get("mode", ""))]
		row["summary"] = "%s party %d" % [String(row.get("presence", "")), int(row.get("party_size", 0))]
		rows.append(row)
	return rows

func link_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for item in SOCIAL_LINKS:
		var row := item.duplicate(true)
		row["enabled"] = true
		row["ui_action"] = "open_social_link"
		row["value"] = "%s | %s" % [String(row.get("kind", "")), String(row.get("channel", ""))]
		row["summary"] = "%s - %s" % [String(row.get("title", "")), String(row.get("description", ""))]
		rows.append(row)
	return rows

func promotion_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for row in link_rows():
		if String(row.get("kind", "")) == "promotion":
			rows.append(row)
	return rows

func friend_page_rows() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	result.append({
		"id": "friends_summary",
		"label_key": "screen.friends.summary",
		"value": "%d online %d invites" % [online_friend_count(), invite_requests.size()],
		"summary": "presence, invites, social links",
		"enabled": true,
	})
	result.append({"id": "friends_social", "screen": "social", "label_key": "screen.main.social", "summary": "announcements and social media", "enabled": true})
	result.append({"id": "friends_promotions", "screen": "promotions", "label_key": "screen.main.promotions", "summary": "wishlist, creator, campaign links", "enabled": true})
	result.append_array(friend_rows())
	return result

func promotion_page_rows() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	result.append({
		"id": "promotions_summary",
		"label_key": "screen.promotions.summary",
		"value": "%d links last %s" % [promotion_rows().size(), last_opened_link_id if not last_opened_link_id.is_empty() else "none"],
		"summary": "wishlist, creator program, campaign links",
		"enabled": true,
	})
	result.append({"id": "promotions_social", "screen": "social", "label_key": "screen.main.social", "summary": "community channels and announcements", "enabled": true})
	result.append({"id": "promotions_friends", "screen": "friends", "label_key": "screen.main.friends", "summary": "invite friends before opening campaign links", "enabled": true})
	result.append_array(promotion_rows())
	return result

func rows() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	result.append({
		"id": "social_summary",
		"label_key": "screen.social.summary",
		"value": summary(),
		"summary": "announcements, friends, social media, promotion links",
		"enabled": true,
	})
	result.append_array(announcement_rows())
	result.append_array(friend_rows())
	result.append_array(link_rows())
	return result

func dismiss_announcement(announcement_id: String) -> Dictionary:
	if announcement_id.is_empty():
		return {"ok": false, "reason": "announcement_missing"}
	dismissed_announcements[announcement_id] = true
	return {"ok": true, "announcement_id": announcement_id, "unread_count": unread_count()}

func invite_friend(friend_id: String) -> Dictionary:
	var friend := _friend_by_id(friend_id)
	if friend.is_empty():
		return {"ok": false, "reason": "friend_missing"}
	if String(friend.get("status", "")) == "offline":
		return {"ok": false, "reason": "friend_offline"}
	selected_friend_id = friend_id
	var request := {
		"friend_id": friend_id,
		"display_name": String(friend.get("display_name", "")),
		"status": "pending_server",
		"client_result_authoritative": false,
	}
	invite_requests.append(request)
	if invite_requests.size() > 16:
		invite_requests.pop_front()
	return {"ok": true, "request": request}

func open_social_link(link_id: String) -> Dictionary:
	var link := _link_by_id(link_id)
	if link.is_empty():
		return {"ok": false, "reason": "link_missing"}
	last_opened_link_id = link_id
	return {"ok": true, "link_id": link_id, "url": String(link.get("url", "")), "kind": String(link.get("kind", ""))}

func unread_count() -> int:
	var count := 0
	for item in ANNOUNCEMENTS:
		if bool(item.get("unread", false)) and not bool(dismissed_announcements.get(String(item.get("id", "")), false)):
			count += 1
	return count

func online_friend_count() -> int:
	var count := 0
	for item in FRIENDS:
		if String(item.get("status", "")) != "offline":
			count += 1
	return count

func summary() -> String:
	return "ann %d friends %d invites %d link %s" % [
		unread_count(),
		online_friend_count(),
		invite_requests.size(),
		last_opened_link_id if not last_opened_link_id.is_empty() else "none",
	]

func _friend_by_id(friend_id: String) -> Dictionary:
	for item in FRIENDS:
		if String(item.get("id", "")) == friend_id:
			return item.duplicate(true)
	return {}

func _link_by_id(link_id: String) -> Dictionary:
	for item in SOCIAL_LINKS:
		if String(item.get("id", "")) == link_id:
			return item.duplicate(true)
	return {}
