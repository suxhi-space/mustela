/**
 * A compact unicode emoji set for the picker and :shortcode: replacement.
 * Not exhaustive on purpose: the common ~300, grouped like most pickers.
 * Anything else can still be typed or pasted directly.
 */
const RAW: [string, string][] = [
  ["Smileys", "grinning:😀 smiley:😃 smile:😄 grin:😁 laughing:😆 sweat_smile:😅 rofl:🤣 joy:😂 slight_smile:🙂 upside_down:🙃 wink:😉 blush:😊 innocent:😇 smiling_face_with_hearts:🥰 heart_eyes:😍 star_struck:🤩 kissing_heart:😘 yum:😋 stuck_out_tongue:😛 zany_face:🤪 money_mouth:🤑 hugging:🤗 thinking:🤔 shushing_face:🤫 zipper_mouth:🤐 raised_eyebrow:🤨 neutral_face:😐 expressionless:😑 no_mouth:😶 smirk:😏 unamused:😒 rolling_eyes:🙄 grimacing:😬 relieved:😌 pensive:😔 sleepy:😪 drooling_face:🤤 sleeping:😴 mask:😷 nauseated_face:🤢 sneezing_face:🤧 hot_face:🥵 cold_face:🥶 woozy_face:🥴 dizzy_face:😵 exploding_head:🤯 cowboy:🤠 partying_face:🥳 sunglasses:😎 nerd:🤓 monocle:🧐 confused:😕 worried:😟 slight_frown:🙁 open_mouth:😮 hushed:😯 astonished:😲 flushed:😳 pleading_face:🥺 frowning:😦 anguished:😧 fearful:😨 cold_sweat:😰 cry:😢 sob:😭 scream:😱 confounded:😖 persevere:😣 disappointed:😞 sweat:😓 weary:😩 tired_face:😫 yawning_face:🥱 triumph:😤 rage:😡 angry:😠 skull:💀 poop:💩 clown:🤡 ghost:👻 alien:👽 robot:🤖 smiley_cat:😺 heart_eyes_cat:😻 see_no_evil:🙈 hear_no_evil:🙉 speak_no_evil:🙊"],
  ["People", "wave:👋 raised_hand:✋ ok_hand:👌 pinched_fingers:🤌 v:✌️ crossed_fingers:🤞 love_you_gesture:🤟 metal:🤘 call_me:🤙 point_left:👈 point_right:👉 point_up:☝️ point_down:👇 thumbsup:👍 +1:👍 thumbsdown:👎 -1:👎 fist:✊ punch:👊 clap:👏 raised_hands:🙌 open_hands:👐 palms_up:🤲 handshake:🤝 pray:🙏 writing_hand:✍️ nail_care:💅 muscle:💪 brain:🧠 eyes:👀 eye:👁️ tongue:👅 lips:👄 baby:👶 person:🧑 man:👨 woman:👩 older_person:🧓 detective:🕵️ superhero:🦸 mage:🧙 vampire:🧛 zombie:🧟 dancer:💃 man_dancing:🕺 shrug:🤷 facepalm:🤦 bow:🙇 raising_hand:🙋 ok_person:🙆 no_good:🙅 tipping_hand:💁"],
  ["Nature", "dog:🐶 cat:🐱 mouse:🐭 hamster:🐹 rabbit:🐰 fox:🦊 bear:🐻 panda:🐼 koala:🐨 tiger:🐯 lion:🦁 cow:🐮 pig:🐷 frog:🐸 monkey:🐵 chicken:🐔 penguin:🐧 bird:🐦 duck:🦆 eagle:🦅 owl:🦉 bat:🦇 wolf:🐺 boar:🐗 horse:🐴 unicorn:🦄 bee:🐝 bug:🐛 butterfly:🦋 snail:🐌 ladybug:🐞 turtle:🐢 snake:🐍 lizard:🦎 octopus:🐙 squid:🦑 crab:🦀 fish:🐟 tropical_fish:🐠 dolphin:🐬 whale:🐳 shark:🦈 otter:🦦 badger:🦡 skunk:🦨 sloth:🦥 hedgehog:🦔 feather:🪶 paw_prints:🐾 dragon:🐉 cactus:🌵 christmas_tree:🎄 evergreen_tree:🌲 deciduous_tree:🌳 palm_tree:🌴 seedling:🌱 herb:🌿 shamrock:☘️ four_leaf_clover:🍀 maple_leaf:🍁 fallen_leaf:🍂 mushroom:🍄 bouquet:💐 rose:🌹 hibiscus:🌺 sunflower:🌻 blossom:🌼 tulip:🌷 cherry_blossom:🌸 sun:☀️ sun_with_face:🌞 full_moon:🌕 crescent_moon:🌙 star:⭐ star2:🌟 sparkles:✨ zap:⚡ fire:🔥 boom:💥 snowflake:❄️ cloud:☁️ rainbow:🌈 umbrella:☔ droplet:💧 ocean:🌊"],
  ["Food", "apple:🍎 green_apple:🍏 pear:🍐 tangerine:🍊 lemon:🍋 banana:🍌 watermelon:🍉 grapes:🍇 strawberry:🍓 blueberries:🫐 cherries:🍒 peach:🍑 mango:🥭 pineapple:🍍 coconut:🥥 kiwi:🥝 tomato:🍅 avocado:🥑 eggplant:🍆 potato:🥔 carrot:🥕 corn:🌽 hot_pepper:🌶️ broccoli:🥦 garlic:🧄 bread:🍞 croissant:🥐 cheese:🧀 egg:🥚 bacon:🥓 pancakes:🥞 hamburger:🍔 fries:🍟 pizza:🍕 hotdog:🌭 sandwich:🥪 taco:🌮 burrito:🌯 ramen:🍜 spaghetti:🍝 sushi:🍣 bento:🍱 dumpling:🥟 rice:🍚 curry:🍛 icecream:🍦 doughnut:🍩 cookie:🍪 cake:🍰 birthday:🎂 cupcake:🧁 chocolate_bar:🍫 candy:🍬 lollipop:🍭 popcorn:🍿 coffee:☕ tea:🍵 bubble_tea:🧋 beer:🍺 beers:🍻 wine_glass:🍷 cocktail:🍸 tropical_drink:🍹 champagne:🍾 milk:🥛"],
  ["Activities", "soccer:⚽ basketball:🏀 football:🏈 baseball:⚾ tennis:🎾 volleyball:🏐 8ball:🎱 ping_pong:🏓 badminton:🏸 goal:🥅 golf:⛳ fishing:🎣 boxing_glove:🥊 martial_arts:🥋 ski:🎿 sled:🛷 ice_skate:⛸️ trophy:🏆 medal:🏅 first_place:🥇 second_place:🥈 third_place:🥉 video_game:🎮 joystick:🕹️ game_die:🎲 jigsaw:🧩 chess_pawn:♟️ dart:🎯 bowling:🎳 art:🎨 performing_arts:🎭 microphone:🎤 headphones:🎧 musical_note:🎵 notes:🎶 guitar:🎸 piano:🎹 trumpet:🎺 violin:🎻 drum:🥁 clapper:🎬 tada:🎉 confetti_ball:🎊 balloon:🎈 gift:🎁 ribbon:🎀 crown:👑 gem:💎 ring:💍"],
  ["Objects", "watch:⌚ iphone:📱 computer:💻 keyboard:⌨️ desktop:🖥️ printer:🖨️ mouse_three_button:🖱️ joystick2:🕹️ cd:💿 camera:📷 video_camera:📹 movie_camera:🎥 tv:📺 radio:📻 telephone:☎️ battery:🔋 electric_plug:🔌 bulb:💡 flashlight:🔦 candle:🕯️ money_with_wings:💸 dollar:💵 credit_card:💳 envelope:✉️ email:📧 package:📦 pencil:✏️ pen:🖊️ memo:📝 calendar:📅 clipboard:📋 pushpin:📌 paperclip:📎 scissors:✂️ lock:🔒 unlock:🔓 key:🔑 hammer:🔨 wrench:🔧 gear:⚙️ link:🔗 magnet:🧲 hourglass:⌛ alarm_clock:⏰ books:📚 book:📖 bookmark:🔖 newspaper:📰 rocket:🚀 airplane:✈️ car:🚗 bike:🚲 house:🏠 tent:⛺ moyai:🗿 bell:🔔 mag:🔍 shield:🛡️ crystal_ball:🔮 pill:💊 test_tube:🧪 dna:🧬 telescope:🔭 satellite:🛰️"],
  ["Symbols", "heart:❤️ orange_heart:🧡 yellow_heart:💛 green_heart:💚 blue_heart:💙 purple_heart:💜 black_heart:🖤 white_heart:🤍 brown_heart:🤎 broken_heart:💔 two_hearts:💕 sparkling_heart:💖 heartpulse:💗 heartbeat:💓 revolving_hearts:💞 cupid:💘 gift_heart:💝 heart_exclamation:❣️ 100:💯 anger:💢 dash:💨 dizzy:💫 speech_balloon:💬 thought_balloon:💭 zzz:💤 white_check_mark:✅ heavy_check_mark:✔️ x:❌ negative_squared_cross_mark:❎ warning:⚠️ no_entry:⛔ question:❓ exclamation:❗ bangbang:‼️ interrobang:⁉️ recycle:♻️ infinity:♾️ peace:☮️ yin_yang:☯️ radioactive:☢️ new:🆕 free:🆓 cool:🆒 ok:🆗 sos:🆘 up:🆙 red_circle:🔴 orange_circle:🟠 yellow_circle:🟡 green_circle:🟢 blue_circle:🔵 purple_circle:🟣 black_circle:⚫ white_circle:⚪ arrow_up:⬆️ arrow_down:⬇️ arrow_left:⬅️ arrow_right:➡️ arrows_counterclockwise:🔄 musical_score:🎼 copyright:©️ registered:®️ tm:™️ checkered_flag:🏁 triangular_flag:🚩 rainbow_flag:🏳️‍🌈 transgender_flag:🏳️‍⚧️ pirate_flag:🏴‍☠️"],
];

export interface EmojiEntry { name: string; char: string }
export const EMOJI_GROUPS: { title: string; items: EmojiEntry[] }[] = RAW.map(([title, s]) => ({
  title,
  items: s.split(" ").filter(Boolean).map((pair) => {
    const k = pair.indexOf(":");
    return { name: pair.slice(0, k), char: pair.slice(k + 1) };
  }),
}));

const BY_NAME = new Map<string, string>();
for (const g of EMOJI_GROUPS) for (const e of g.items) if (!BY_NAME.has(e.name)) BY_NAME.set(e.name, e.char);

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
