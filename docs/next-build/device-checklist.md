# 0.1.7-build1: what to check on a real device

The screens were checked automatically at four sizes (desktop, phone, tablet upright and sideways) with no errors, after round 2 as well.
These are the parts only a real phone, tablet or computer can confirm.

## Android (phone and tablet)

**Notifications** (Settings > Notifications on, and test with the app in the background, then closed)
- [ ] A DM shows as its own notification with the sender's picture; a second message from them updates it (no second ring right away)
- [ ] Messages from two chats: both show, grouped under "Mustela · 2 chats"
- [ ] Reply from the notification: the message arrives in the chat, and the notification shows "You: …"
- [ ] Mark as read: the notification goes, and the chat is read in the app and on your computer
- [ ] Tapping it opens the chat at that message
- [ ] Reading the chat on your computer clears it on the phone
- [ ] Android Settings > Apps > Mustela > Notifications shows "Direct messages", "Group chats", "Mentions and replies"
- [ ] The chat appears in the Conversations section at the top of the shade (long-press: Priority)
- [ ] No Mustela message sound on top of the phone's own notification sound

**+ card: recent photos**
- [ ] First time: "Show your recent photos here" with Allow; after allowing, the grid appears (Android 14+: "Select photos" also works)
- [ ] Opens halfway; scrolling moves the buttons away, the card grows, and more photos keep loading
- [ ] Tapping a photo or video attaches it

**Picture viewer** (these never ran on phones before; fixed in round 2)
- [ ] Save: lands in Photos (Pictures/Mustela) or Videos, with "Saved to Photos"
- [ ] Share: the share sheet sends the picture itself (try sending it to another app)
- [ ] Open in browser opens it

**Keyboard**
- [ ] Nickname / rename dialogs stay above the keyboard at their full size (title, box and buttons)
- [ ] The message box doesn't scroll on a single line
- [ ] Emoji card search: the card lifts above the keyboard
- [ ] Tablet sideways, typing in a chat: the message box sits right above the keyboard, no big gap, and the side lists don't shrink

**Other**
- [ ] Switching back to Mustela doesn't flash
- [ ] Holding an emoji in the emoji card favorites it once (vibration + "added to favorites")
- [ ] Holding a message: the card comes up halfway, the message stays visible and highlighted, nothing in the card lights up by itself
- [ ] With that card open, long-press the message text: the phone's own handles and Copy / Select all / Share bar appear
- [ ] Holding a DM, channel or server: the same halfway, grouped card
- [ ] Double tap a message to react, on the text and on a picture (one tap on a picture still opens it); Change picks another emoji
- [ ] Tapping a message doesn't leave it tinted
- [ ] Swipe right in a chat back to the list: smooth, no up-and-down wobble; swiping the "active now" row just scrolls it
- [ ] Emoji card: tapping a server in the bottom bar jumps to it from anywhere (also above); Emoji ⇄ GIFs slides
- [ ] GIFs show quickly the first time after opening the app
- [ ] Call: the speaking outline on your tile is complete at the top; the mini view and picture-in-picture light up when you talk

**Round 3**
- [ ] Nickname / rename / new pin group dialogs: one rounded card around title, text, box and buttons, with the keyboard up
- [ ] Search in a chat: the message box doesn't show over the results; Media with lots of pictures scrolls, no overlapping
- [ ] Search results look like messages: one-line names with "…", times like 25d or 3mo
- [ ] Home search (search button at the top of Messages): People, Messages, Media, Pins, Links, Files; the filter button's "Filter results…" menu and its chips
- [ ] + card: rounded photos, All / By date, and the handle on the right beside the photos (hold and drag: the month shows)
- [ ] + card: four photos across; tap several (numbers 1, 2, 3…), tap one again to untick it, "Add" puts them all on the message (5 at most)
- [ ] Attach a picture and a video, tap each tile above the message box: big preview, Mark as spoiler (the tile says Spoiler), Remove file
- [ ] Scroll the + card, a long hold card and the member list: the content slides under a band at the top, not into the rounded edge
- [ ] Emoji ⇄ GIFs: the card stays put and slides between them
- [ ] Swipe back from a chat: follows your finger, list eases in underneath
- [ ] Friends page: header row with title and Add friend, tabs on their own row
- [ ] Uncover a spoilered picture in the chat, open the viewer, swipe to it: it's uncovered
- [ ] Edit profile: the close button stays at the top while you scroll
- [ ] Server settings > Overview: Change icon / banner opens the crop tool (square icon, 16:9 banner)
- [ ] A new pin group or favorites category starts with no colour

## Desktop (Windows, macOS, Linux)
- [ ] Clicking a notification opens that chat
- [ ] Mic and speaker menus open above the nameplate, with Input / Output volume; the green level under Input volume moves when you talk
- [ ] Input volume changes how loud you are to others in a call
- [ ] Voice & video settings: the sensitivity slider shows your level without starting the mic test
- [ ] Settings search: "in vol", "password", "theme" each find the setting and take you to it
- [ ] "Find or start a conversation" above the DM list, and Ctrl+K anywhere: recent channels, then people, channels and servers as you type; "Search messages for …" opens message search
- [ ] The + next to Direct messages opens New message
- [ ] Message box: + , emoji and send sit on the middle of the line at your text size
- [ ] Save a theme with a window material (Mica / Acrylic), change it, apply the theme: the material comes back
- [ ] Settings: the page title stays at the top while you scroll, with no box behind it
- [ ] Drag a pin group heading above another; the colour shows on the group's name
- [ ] A Tumblr post with two pictures shows both, as a tumblr.com, txtumblr.com or tpmblr.com link (try https://www.tumblr.com/babelnimrod/832541645844119552)
- [ ] Single-picture posts on other sites (Fur Affinity, DeviantArt, pixiv…) look the same as before
- [ ] Open the DMs and channels that used to open on "You're viewing older messages" (ones with link cards, X posts, pictures): they open at the bottom with no bar
- [ ] Send a message, close Mustela, open it again: that chat isn't unread
- [ ] Mark a chat unread where the last message is yours, close and open Mustela: it's still unread
- [ ] Phone: with the keyboard up, tap the "new messages" bar: it jumps to the New line
- [ ] Change your banner, move it in the crop tool, save: your own card (nameplate) shows exactly the band between the lines, straight away
- [ ] Crop tool: drag the banner all the way up and all the way down: the picture's bottom or top edge can sit inside the lines, blurred fill outside
- [ ] New message (+ at the top of Messages): type in the search box, the list narrows (names and usernames)
- [ ] Mark a message unread (someone else's, then one of yours), go to another chat, come back: the New line is right above that message
- [ ] Rest the mouse on the bottom edge of a server icon: no bouncing, one click opens it
- [ ] Send a favourite GIF from media1.tenor.com: only the GIF shows (no link text), it holds still with another window in front
- [ ] "Keep animating in the background" off: GIFs, animated emoji and animated avatars hold still while another window is in front, and play again when you come back
- [ ] "Play GIFs and animated emoji" off: animated emoji hold still and play while you point at them
- [ ] Gradient theme: one smooth gradient, no blocks or seams
- [ ] Saved themes: save, change the look, apply, and check it on a second device

## Tablet held sideways (Round 4)
- [ ] Type a message: only the chat and the message box move up; the user bar and channel list stay behind the keyboard
- [ ] Tap the search button in a chat and type: the message box and user bar stay behind the keyboard; the results end where the keyboard starts
- [ ] Search in a chat, open a result, Jump to message: the search closes and the message shows in the chat
- [ ] Home: the Search field opens search in the chat area (servers and DMs still beside it); picking a result, or tapping a DM in the list, closes it

## Round 6
- [ ] Edit profile: change the banner, save: the new one stays in the editor
- [ ] Settings on a phone: the search box is full width and finds settings
- [ ] Mark a message unread in a chat with your messages after it: the bar counts only theirs, same as the badge
- [ ] Accessibility text size bigger: search results (chat search and Home search) get bigger too
- [ ] Open a DM: its row in the list shows their name style
- [ ] A server with over 1,000 members: decorations and nameplates in the chat and member list hold still; open someone's card and it plays; turn the option off in Performance and they move again

## Round 7
- [ ] New message (+ at the top of Messages): with the keyboard up, the whole card shows (search box, friends, buttons)
- [ ] Search a word in a chat, open a result, In context: pictures are small tiles, the message is in view; Jump to message puts it in the middle of the chat
- [ ] Home search > Messages > a result in another chat: it opens with that message in the middle (even with pictures around it)
- [ ] Chat search on a phone: tap "From anyone" straight away: everyone in the chat is listed

## Round 8 (Android)
- [ ] + card > Camera: your phone's own camera app opens (asks for the camera the first time); take a photo: it's on the message, and it's NOT in your gallery
- [ ] Same, then cancel in the camera: you're back in the same chat
- [ ] + card > Video: same as Camera, for a video (some camera apps save videos to the gallery anyway; note which one if so)
- [ ] If Android closes Mustela while the camera is open: Mustela reopens that chat with the photo attached
- [ ] Attached files: the X on a tile removes it; tapping the tile opens the card with the spoiler switch and Remove visible, picture at full quality

## Round 9
- [ ] At the bottom of a chat with pictures, drag up slowly a little at a time: it never snaps back down while your finger is on it
- [ ] Scroll a long chat and the channel list up and down quickly: smooth, no catching; swipe right in a chat still goes back, and the chat doesn't wobble while you swipe
- [ ] Play a YouTube video in a chat and tap its YouTube logo or title: it opens in your browser, Mustela stays where it was
- [ ] Tap a link inside a link preview: it opens in your browser

## Round 10
- [ ] A server where you have no permissions: no gear next to its name, no "Server settings" in its menu
- [ ] A channel with a picture: the picture shows next to it in the channel list
- [ ] Channel settings of a voice channel: Slowmode is there
- [ ] Server and channel settings (desktop): the first heading has room above it
- [ ] Someone with a role icon: it sits right next to their name, lined up with it
- [ ] Edit profile: the X closes it (desktop, phone, tablet)
- [ ] Right-click a folder / pin group / favorites category > Colour > Custom colour…: pick one, Apply: it's used (on phones the picker comes from the bottom)
- [ ] A friend comes online while a server with them is open: they move to Online within a few seconds, no restart
- [ ] Reply to a message with a custom emoji: the reply line shows the emoji
- [ ] A DM with someone who has a decoration and a profile effect: both keep moving while you scroll the chat
- [ ] Someone listening to music with buttons: their card shows it in one box, buttons full width in their colours; full profile: Activity tab has it, their card doesn't
- [ ] DM side card: About me above the activity; "View full profile" at the bottom of the card
- [ ] Someone in voice: their card shows it in a box with Join voice; once you're in that call it says Open voice and takes you there
- [ ] The status bubble's pointed corner is at the top left, by the avatar
- [ ] (Android) Close Mustela (home button, wait a minute), have someone message you, screen on: the notification comes within about a minute
- [ ] (Android) Same with the screen off: it comes within about 15 minutes (Android batches background checks)
- [ ] (Android) Tap a message notification: Mustela opens that chat at that message (from closed, and from the background)
- [ ] Someone with pronouns set: a small pill with them sits after their name (and role icon) in messages
- [ ] Phone Home, a friend in voice with others: the card shows a tile of faces (friends first, "+N" past 3), tapping it opens a card from the bottom (people, stream, activities, Join voice); the channel name opens the channel; drag it down to close
- [ ] Someone in voice playing something with a picture (rich presence): its icon shows beside their name under the voice channel, in the call and in the call card
- [ ] Mark a DM message as unread, leave the chat: its row and its picture under Home show a dot, no number; when they write again it shows the number of new messages
- [ ] In a server where you may mention everyone: type @every, pick @everyone, send: it shows as a mention, and people get notified
- [ ] A channel with GitHub (or another bot) posts: headings, links, quotes and code show formatted
- [ ] A "joined the server" line: the name is a chip with their picture; tapping it opens their card
- [ ] A video in chat has rounded corners like pictures (desktop: Windows and Mac); opened in the viewer, pictures and videos have square corners

