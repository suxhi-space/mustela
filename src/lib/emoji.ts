import { inTauri } from "./platform";
import { EMOJI_DATA } from "./emoji-data";

/**
 * Short names people already type (:joy:, :thumbsup:, :+1:…) for common emoji. The picker shows every standard
 * emoji (emoji-data.ts); these names are just extra ways to find and type them, and win when naming one.
 */
const ALIASES: [string, string][] = [
  ["Smileys", "grinning:😀 smiley:😃 smile:😄 grin:😁 laughing:😆 sweat_smile:😅 rofl:🤣 joy:😂 slight_smile:🙂 upside_down:🙃 wink:😉 blush:😊 innocent:😇 smiling_face_with_hearts:🥰 heart_eyes:😍 star_struck:🤩 kissing_heart:😘 yum:😋 stuck_out_tongue:😛 zany_face:🤪 money_mouth:🤑 hugging:🤗 thinking:🤔 shushing_face:🤫 zipper_mouth:🤐 raised_eyebrow:🤨 neutral_face:😐 expressionless:😑 no_mouth:😶 smirk:😏 unamused:😒 rolling_eyes:🙄 grimacing:😬 relieved:😌 pensive:😔 sleepy:😪 drooling_face:🤤 sleeping:😴 mask:😷 nauseated_face:🤢 sneezing_face:🤧 hot_face:🥵 cold_face:🥶 woozy_face:🥴 dizzy_face:😵 exploding_head:🤯 cowboy:🤠 partying_face:🥳 sunglasses:😎 nerd:🤓 monocle:🧐 confused:😕 worried:😟 slight_frown:🙁 open_mouth:😮 hushed:😯 astonished:😲 flushed:😳 pleading_face:🥺 frowning:😦 anguished:😧 fearful:😨 cold_sweat:😰 cry:😢 sob:😭 scream:😱 confounded:😖 persevere:😣 disappointed:😞 sweat:😓 weary:😩 tired_face:😫 yawning_face:🥱 triumph:😤 rage:😡 angry:😠 skull:💀 poop:💩 clown:🤡 ghost:👻 alien:👽 robot:🤖 smiley_cat:😺 heart_eyes_cat:😻 see_no_evil:🙈 hear_no_evil:🙉 speak_no_evil:🙊"],
  ["People", "wave:👋 raised_hand:✋ ok_hand:👌 pinched_fingers:🤌 v:✌️ crossed_fingers:🤞 love_you_gesture:🤟 metal:🤘 call_me:🤙 point_left:👈 point_right:👉 point_up:☝️ point_down:👇 thumbsup:👍 +1:👍 thumbsdown:👎 -1:👎 fist:✊ punch:👊 clap:👏 raised_hands:🙌 open_hands:👐 palms_up:🤲 handshake:🤝 pray:🙏 writing_hand:✍️ nail_care:💅 muscle:💪 brain:🧠 eyes:👀 eye:👁️ tongue:👅 lips:👄 baby:👶 person:🧑 man:👨 woman:👩 older_person:🧓 detective:🕵️ superhero:🦸 mage:🧙 vampire:🧛 zombie:🧟 dancer:💃 man_dancing:🕺 shrug:🤷 facepalm:🤦 bow:🙇 raising_hand:🙋 ok_person:🙆 no_good:🙅 tipping_hand:💁"],
  ["Nature", "dog:🐶 cat:🐱 mouse:🐭 hamster:🐹 rabbit:🐰 fox:🦊 bear:🐻 panda:🐼 koala:🐨 tiger:🐯 lion:🦁 cow:🐮 pig:🐷 frog:🐸 monkey:🐵 chicken:🐔 penguin:🐧 bird:🐦 duck:🦆 eagle:🦅 owl:🦉 bat:🦇 wolf:🐺 boar:🐗 horse:🐴 unicorn:🦄 bee:🐝 bug:🐛 butterfly:🦋 snail:🐌 ladybug:🐞 turtle:🐢 snake:🐍 lizard:🦎 octopus:🐙 squid:🦑 crab:🦀 fish:🐟 tropical_fish:🐠 dolphin:🐬 whale:🐳 shark:🦈 otter:🦦 badger:🦡 skunk:🦨 sloth:🦥 hedgehog:🦔 feather:🪶 paw_prints:🐾 dragon:🐉 cactus:🌵 christmas_tree:🎄 evergreen_tree:🌲 deciduous_tree:🌳 palm_tree:🌴 seedling:🌱 herb:🌿 shamrock:☘️ four_leaf_clover:🍀 maple_leaf:🍁 fallen_leaf:🍂 mushroom:🍄 bouquet:💐 rose:🌹 hibiscus:🌺 sunflower:🌻 blossom:🌼 tulip:🌷 cherry_blossom:🌸 sun:☀️ sun_with_face:🌞 full_moon:🌕 crescent_moon:🌙 star:⭐ star2:🌟 sparkles:✨ zap:⚡ fire:🔥 boom:💥 snowflake:❄️ cloud:☁️ rainbow:🌈 umbrella:☔ droplet:💧 ocean:🌊"],
  ["Food", "apple:🍎 green_apple:🍏 pear:🍐 tangerine:🍊 lemon:🍋 banana:🍌 watermelon:🍉 grapes:🍇 strawberry:🍓 blueberries:🫐 cherries:🍒 peach:🍑 mango:🥭 pineapple:🍍 coconut:🥥 kiwi:🥝 tomato:🍅 avocado:🥑 eggplant:🍆 potato:🥔 carrot:🥕 corn:🌽 hot_pepper:🌶️ broccoli:🥦 garlic:🧄 bread:🍞 croissant:🥐 cheese:🧀 egg:🥚 bacon:🥓 pancakes:🥞 hamburger:🍔 fries:🍟 pizza:🍕 hotdog:🌭 sandwich:🥪 taco:🌮 burrito:🌯 ramen:🍜 spaghetti:🍝 sushi:🍣 bento:🍱 dumpling:🥟 rice:🍚 curry:🍛 icecream:🍦 doughnut:🍩 cookie:🍪 cake:🍰 birthday:🎂 cupcake:🧁 chocolate_bar:🍫 candy:🍬 lollipop:🍭 popcorn:🍿 coffee:☕ tea:🍵 bubble_tea:🧋 beer:🍺 beers:🍻 wine_glass:🍷 cocktail:🍸 tropical_drink:🍹 champagne:🍾 milk:🥛"],
  ["Activities", "soccer:⚽ basketball:🏀 football:🏈 baseball:⚾ tennis:🎾 volleyball:🏐 8ball:🎱 ping_pong:🏓 badminton:🏸 goal:🥅 golf:⛳ fishing:🎣 boxing_glove:🥊 martial_arts:🥋 ski:🎿 sled:🛷 ice_skate:⛸️ trophy:🏆 medal:🏅 first_place:🥇 second_place:🥈 third_place:🥉 video_game:🎮 joystick:🕹️ game_die:🎲 jigsaw:🧩 chess_pawn:♟️ dart:🎯 bowling:🎳 art:🎨 performing_arts:🎭 microphone:🎤 headphones:🎧 musical_note:🎵 notes:🎶 guitar:🎸 piano:🎹 trumpet:🎺 violin:🎻 drum:🥁 clapper:🎬 tada:🎉 confetti_ball:🎊 balloon:🎈 gift:🎁 ribbon:🎀 crown:👑 gem:💎 ring:💍"],
  ["Objects", "watch:⌚ iphone:📱 computer:💻 keyboard:⌨️ desktop:🖥️ printer:🖨️ mouse_three_button:🖱️ joystick2:🕹️ cd:💿 camera:📷 video_camera:📹 movie_camera:🎥 tv:📺 radio:📻 telephone:☎️ battery:🔋 electric_plug:🔌 bulb:💡 flashlight:🔦 candle:🕯️ money_with_wings:💸 dollar:💵 credit_card:💳 envelope:✉️ email:📧 package:📦 pencil:✏️ pen:🖊️ memo:📝 calendar:📅 clipboard:📋 pushpin:📌 paperclip:📎 scissors:✂️ lock:🔒 unlock:🔓 key:🔑 hammer:🔨 wrench:🔧 gear:⚙️ link:🔗 magnet:🧲 hourglass:⌛ alarm_clock:⏰ books:📚 book:📖 bookmark:🔖 newspaper:📰 rocket:🚀 airplane:✈️ car:🚗 bike:🚲 house:🏠 tent:⛺ moyai:🗿 bell:🔔 mag:🔍 shield:🛡️ crystal_ball:🔮 pill:💊 test_tube:🧪 dna:🧬 telescope:🔭 satellite:🛰️"],
  ["Symbols", "heart:❤️ orange_heart:🧡 yellow_heart:💛 green_heart:💚 blue_heart:💙 purple_heart:💜 black_heart:🖤 white_heart:🤍 brown_heart:🤎 broken_heart:💔 two_hearts:💕 sparkling_heart:💖 heartpulse:💗 heartbeat:💓 revolving_hearts:💞 cupid:💘 gift_heart:💝 heart_exclamation:❣️ 100:💯 anger:💢 dash:💨 dizzy:💫 speech_balloon:💬 thought_balloon:💭 zzz:💤 white_check_mark:✅ heavy_check_mark:✔️ x:❌ negative_squared_cross_mark:❎ warning:⚠️ no_entry:⛔ question:❓ exclamation:❗ bangbang:‼️ interrobang:⁉️ recycle:♻️ infinity:♾️ peace:☮️ yin_yang:☯️ radioactive:☢️ new:🆕 free:🆓 cool:🆒 ok:🆗 sos:🆘 up:🆙 red_circle:🔴 orange_circle:🟠 yellow_circle:🟡 green_circle:🟢 blue_circle:🔵 purple_circle:🟣 black_circle:⚫ white_circle:⚪ arrow_up:⬆️ arrow_down:⬇️ arrow_left:⬅️ arrow_right:➡️ arrows_counterclockwise:🔄 musical_score:🎼 copyright:©️ registered:®️ tm:™️ checkered_flag:🏁 triangular_flag:🚩 rainbow_flag:🏳️‍🌈 transgender_flag:🏳️‍⚧️ pirate_flag:🏴‍☠️"],
];

export interface EmojiEntry { name: string; char: string }
const pairs = (s: string) => s.split(" ").filter(Boolean).map((pair) => { const k = pair.indexOf(":"); return { name: pair.slice(0, k), char: pair.slice(k + 1) }; });
const SHORT = new Map<string, string>();
for (const [, s] of ALIASES) for (const e of pairs(s)) { const k = e.char.replace(/\uFE0F/g, ""); if (!SHORT.has(k)) SHORT.set(k, e.name); }
export const EMOJI_GROUPS: { title: string; items: EmojiEntry[] }[] = EMOJI_DATA.map(([title, s]) => ({
  title,
  // Shown by the short name people know where there is one ("joy" rather than "face_with_tears_of_joy").
  items: pairs(s).map((e) => ({ name: SHORT.get(e.char.replace(/\uFE0F/g, "")) ?? e.name, char: e.char })),
}));

const BY_NAME = new Map<string, string>();
for (const [, s] of ALIASES) for (const e of pairs(s)) if (!BY_NAME.has(e.name)) BY_NAME.set(e.name, e.char);
for (const [, s] of EMOJI_DATA) for (const e of pairs(s)) if (!BY_NAME.has(e.name)) BY_NAME.set(e.name, e.char);

export function shortcodeToEmoji(name: string): string | null {
  return BY_NAME.get(name.toLowerCase()) ?? null;
}

/** Prefix search for the picker and the composer's :autocomplete. */
export function searchEmoji(q: string, limit = 40): EmojiEntry[] {
  const s = q.toLowerCase().replace(/^:/, "");
  if (!s) return [];
  const starts: EmojiEntry[] = [], contains: EmojiEntry[] = [];
  for (const [name, char] of BY_NAME) {
    if (name.startsWith(s)) starts.push({ name, char });
    else if (name.includes(s)) contains.push({ name, char });
  }
  return [...starts, ...contains].slice(0, limit);
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

const BY_CHAR = new Map<string, string>(SHORT);
for (const g of EMOJI_GROUPS) for (const e of g.items) { const k = e.char.replace(/\uFE0F/g, ""); if (!BY_CHAR.has(k)) BY_CHAR.set(k, e.name); }
/** Shortcode for a unicode emoji ("🔥" → "fire"), if it's one we know. */
export const emojiName = (char: string) => BY_CHAR.get(char.replace(/\uFE0F/g, "")) ?? null;

/** Emoji sequences (with skin tones, ZWJ families and flags) inside plain text. */
export const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

/* ---------------------------------------------------------------- Stoat emoji packs */

/** Stoat lets a message pick the pack for the emoji after it with one of these private-use characters. */
export const PACK_PUA: Record<string, string> = { "": "fluent-3d", "": "fluent-3d", "": "fluent-flat", "": "mutant", "": "noto", "": "twemoji" };
/** Same as EMOJI_RE, but also takes Stoat's optional pack prefix. */
export const PACKED_EMOJI_RE = new RegExp(`[\\uE0E0-\\uE0E6]?(?:${EMOJI_RE.source})`, "gu");
/** Stoat's file naming: each code point in hex, joined with dashes. */
export const toCodepoint = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16)).join("-");
/**
 * Where an emoji picture comes from. In the app, Mustela's own emoji store (src-tauri/src/emoji_store.rs): it fetches
 * each picture from Stoat once and keeps it on this device, so it shows instantly next time, even offline. In a
 * browser (the demo), Stoat's server directly.
 */
const STORE = (() => {
  if (!inTauri()) return null;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // Windows and Android web views reach app schemes as http://<scheme>.localhost; macOS and Linux as <scheme>://localhost.
  return /Windows|Android/i.test(ua) ? "http://emoji.localhost/" : "emoji://localhost/";
})();
export const emojiUrl = (pack: string, char: string) => (STORE ? `${STORE}${pack}/${toCodepoint(char)}.svg` : `https://static.stoat.chat/emoji/${pack}/${toCodepoint(char)}.svg?v=1`);

/* ---------- emoji pictures: loaded once, shared by every place that shows them ---------- */

const loaded = new Set<string>();
const loading = new Map<string, Promise<boolean>>();

/** Whether this emoji picture is already loaded (it can be drawn straight away, with no flash). */
export const emojiReady = (url: string) => loaded.has(url);

/** Load an emoji picture once; every later use draws it from memory. Resolves false if it doesn't exist. */
export function loadEmoji(url: string): Promise<boolean> {
  if (loaded.has(url)) return Promise.resolve(true);
  let p = loading.get(url);
  if (!p) {
    p = new Promise<boolean>((done) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => { loaded.add(url); loading.delete(url); done(true); };
      img.onerror = () => { loading.delete(url); done(false); };
      img.src = url;
    });
    loading.set(url, p);
  }
  return p;
}

/**
 * Load a set of emoji in the background, a few at a time while the app is idle, so the ones you're likely to see
 * (your frequent ones, the first sections of the picker) are already there when you look.
 */
export function warmEmoji(pack: string, chars: string[]) {
  if (pack === "system" || typeof window === "undefined") return;
  const queue = chars.map((c) => emojiUrl(pack, c)).filter((u) => !loaded.has(u));
  const idle = (f: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback ?? ((g: () => void) => setTimeout(g, 50)))(f, { timeout: 2000 });
  const step = () => {
    const batch = queue.splice(0, 8);
    if (!batch.length) return;
    void Promise.all(batch.map(loadEmoji)).then(() => idle(step));
  };
  idle(step);
}
