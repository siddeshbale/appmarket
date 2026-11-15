// Reference data: market registry, unified taxonomy, and seed store categories.
// Store category names are seeds; when a source supplies a label it is kept as the original store category name.
import type { Db } from './index';

export const DEFAULT_MARKETS = [
  { code: 'us', name: 'United States', lang: 'en', enabled: 1, notes: 'Default market.' },
  { code: 'in', name: 'India', lang: 'en', enabled: 1, notes: 'Default market. English listings; regional-language metadata may differ.' },
  { code: 'gb', name: 'United Kingdom', lang: 'en', enabled: 0, notes: 'Ready — enable after running `npm run smoke:live -- --markets gb`.' },
  { code: 'jp', name: 'Japan', lang: 'ja', enabled: 0, notes: 'Ready — enable after validation. Metadata is Japanese-language.' },
];

export const UNIFIED: [slug: string, name: string, isGame: 0 | 1][] = [
  ['business', 'Business', 0], ['weather', 'Weather', 0], ['utilities', 'Utilities & Tools', 0], ['travel', 'Travel & Local', 0],
  ['sports', 'Sports', 0], ['social', 'Social', 0], ['communication', 'Communication', 0], ['reference', 'Books & Reference', 0],
  ['productivity', 'Productivity', 0], ['photo_video', 'Photo & Video', 0], ['news', 'News & Magazines', 0], ['navigation', 'Maps & Navigation', 0],
  ['music', 'Music & Audio', 0], ['lifestyle', 'Lifestyle', 0], ['health_fitness', 'Health & Fitness', 0], ['finance', 'Finance', 0],
  ['entertainment', 'Entertainment', 0], ['education', 'Education', 0], ['medical', 'Medical', 0], ['food_drink', 'Food & Drink', 0],
  ['shopping', 'Shopping', 0], ['developer_tools', 'Developer Tools', 0], ['design', 'Art & Design', 0], ['dating', 'Dating', 0],
  ['personalization', 'Personalization', 0], ['kids_family', 'Kids, Parenting & Family', 0], ['auto', 'Auto & Vehicles', 0],
  ['home', 'House & Home', 0], ['beauty', 'Beauty', 0], ['comics', 'Comics', 0], ['events', 'Events', 0], ['other', 'Other', 0],
  ['games', 'Games (general)', 1], ['games_action', 'Games · Action', 1], ['games_adventure', 'Games · Adventure', 1],
  ['games_arcade', 'Games · Arcade', 1], ['games_board', 'Games · Board', 1], ['games_card', 'Games · Card', 1],
  ['games_casino', 'Games · Casino', 1], ['games_casual', 'Games · Casual', 1], ['games_educational', 'Games · Educational', 1],
  ['games_family', 'Games · Family', 1], ['games_music', 'Games · Music', 1], ['games_puzzle', 'Games · Puzzle', 1],
  ['games_racing', 'Games · Racing', 1], ['games_rpg', 'Games · Role Playing', 1], ['games_simulation', 'Games · Simulation', 1],
  ['games_sports', 'Games · Sports', 1], ['games_strategy', 'Games · Strategy', 1], ['games_trivia', 'Games · Trivia', 1],
  ['games_word', 'Games · Word', 1], ['games_dice', 'Games · Dice', 1],
];

// [store id, seed name, unified slug, is_game, parent]
export const APPLE_GENRES: [string, string, string, 0 | 1, string | null][] = [
  ['6000', 'Business', 'business', 0, null], ['6001', 'Weather', 'weather', 0, null], ['6002', 'Utilities', 'utilities', 0, null],
  ['6003', 'Travel', 'travel', 0, null], ['6004', 'Sports', 'sports', 0, null], ['6005', 'Social Networking', 'social', 0, null],
  ['6006', 'Reference', 'reference', 0, null], ['6007', 'Productivity', 'productivity', 0, null], ['6008', 'Photo & Video', 'photo_video', 0, null],
  ['6009', 'News', 'news', 0, null], ['6010', 'Navigation', 'navigation', 0, null], ['6011', 'Music', 'music', 0, null],
  ['6012', 'Lifestyle', 'lifestyle', 0, null], ['6013', 'Health & Fitness', 'health_fitness', 0, null], ['6014', 'Games', 'games', 1, null],
  ['6015', 'Finance', 'finance', 0, null], ['6016', 'Entertainment', 'entertainment', 0, null], ['6017', 'Education', 'education', 0, null],
  ['6018', 'Books', 'reference', 0, null], ['6020', 'Medical', 'medical', 0, null], ['6021', 'Magazines & Newspapers', 'news', 0, null],
  ['6022', 'Catalogs', 'shopping', 0, null], ['6023', 'Food & Drink', 'food_drink', 0, null], ['6024', 'Shopping', 'shopping', 0, null],
  ['6025', 'Stickers', 'personalization', 0, null], ['6026', 'Developer Tools', 'developer_tools', 0, null], ['6027', 'Graphics & Design', 'design', 0, null],
  ['7001', 'Action', 'games_action', 1, '6014'], ['7002', 'Adventure', 'games_adventure', 1, '6014'], ['7003', 'Casual', 'games_casual', 1, '6014'],
  ['7004', 'Board', 'games_board', 1, '6014'], ['7005', 'Card', 'games_card', 1, '6014'], ['7006', 'Casino', 'games_casino', 1, '6014'],
  ['7007', 'Dice', 'games_dice', 1, '6014'], ['7008', 'Educational', 'games_educational', 1, '6014'], ['7009', 'Family', 'games_family', 1, '6014'],
  ['7011', 'Music', 'games_music', 1, '6014'], ['7012', 'Puzzle', 'games_puzzle', 1, '6014'], ['7013', 'Racing', 'games_racing', 1, '6014'],
  ['7014', 'Role Playing', 'games_rpg', 1, '6014'], ['7015', 'Simulation', 'games_simulation', 1, '6014'], ['7016', 'Sports', 'games_sports', 1, '6014'],
  ['7017', 'Strategy', 'games_strategy', 1, '6014'], ['7018', 'Trivia', 'games_trivia', 1, '6014'], ['7019', 'Word', 'games_word', 1, '6014'],
];

export const PLAY_CATEGORIES: [string, string, string, 0 | 1][] = [
  ['ART_AND_DESIGN', 'Art & Design', 'design', 0], ['AUTO_AND_VEHICLES', 'Auto & Vehicles', 'auto', 0], ['BEAUTY', 'Beauty', 'beauty', 0],
  ['BOOKS_AND_REFERENCE', 'Books & Reference', 'reference', 0], ['BUSINESS', 'Business', 'business', 0], ['COMICS', 'Comics', 'comics', 0],
  ['COMMUNICATION', 'Communication', 'communication', 0], ['DATING', 'Dating', 'dating', 0], ['EDUCATION', 'Education', 'education', 0],
  ['ENTERTAINMENT', 'Entertainment', 'entertainment', 0], ['EVENTS', 'Events', 'events', 0], ['FINANCE', 'Finance', 'finance', 0],
  ['FOOD_AND_DRINK', 'Food & Drink', 'food_drink', 0], ['HEALTH_AND_FITNESS', 'Health & Fitness', 'health_fitness', 0],
  ['HOUSE_AND_HOME', 'House & Home', 'home', 0], ['LIBRARIES_AND_DEMO', 'Libraries & Demo', 'developer_tools', 0],
  ['LIFESTYLE', 'Lifestyle', 'lifestyle', 0], ['MAPS_AND_NAVIGATION', 'Maps & Navigation', 'navigation', 0], ['MEDICAL', 'Medical', 'medical', 0],
  ['MUSIC_AND_AUDIO', 'Music & Audio', 'music', 0], ['NEWS_AND_MAGAZINES', 'News & Magazines', 'news', 0], ['PARENTING', 'Parenting', 'kids_family', 0],
  ['PERSONALIZATION', 'Personalization', 'personalization', 0], ['PHOTOGRAPHY', 'Photography', 'photo_video', 0],
  ['PRODUCTIVITY', 'Productivity', 'productivity', 0], ['SHOPPING', 'Shopping', 'shopping', 0], ['SOCIAL', 'Social', 'social', 0],
  ['SPORTS', 'Sports', 'sports', 0], ['TOOLS', 'Tools', 'utilities', 0], ['TRAVEL_AND_LOCAL', 'Travel & Local', 'travel', 0],
  ['VIDEO_PLAYERS', 'Video Players & Editors', 'photo_video', 0], ['WEATHER', 'Weather', 'weather', 0],
  ['GAME', 'Games', 'games', 1], ['GAME_ACTION', 'Action', 'games_action', 1], ['GAME_ADVENTURE', 'Adventure', 'games_adventure', 1],
  ['GAME_ARCADE', 'Arcade', 'games_arcade', 1], ['GAME_BOARD', 'Board', 'games_board', 1], ['GAME_CARD', 'Card', 'games_card', 1],
  ['GAME_CASINO', 'Casino', 'games_casino', 1], ['GAME_CASUAL', 'Casual', 'games_casual', 1], ['GAME_EDUCATIONAL', 'Educational', 'games_educational', 1],
  ['GAME_MUSIC', 'Music', 'games_music', 1], ['GAME_PUZZLE', 'Puzzle', 'games_puzzle', 1], ['GAME_RACING', 'Racing', 'games_racing', 1],
  ['GAME_ROLE_PLAYING', 'Role Playing', 'games_rpg', 1], ['GAME_SIMULATION', 'Simulation', 'games_simulation', 1],
  ['GAME_SPORTS', 'Sports', 'games_sports', 1], ['GAME_STRATEGY', 'Strategy', 'games_strategy', 1], ['GAME_TRIVIA', 'Trivia', 'games_trivia', 1],
  ['GAME_WORD', 'Word', 'games_word', 1],
];

/** Idempotent: inserts missing rows only; never overwrites user edits to the taxonomy or market registry. */
export function seedReferenceData(db: Db) {
  const m = db.prepare('INSERT OR IGNORE INTO markets (code, name, default_language, enabled, notes) VALUES (?, ?, ?, ?, ?)');
  for (const x of DEFAULT_MARKETS) m.run(x.code, x.name, x.lang, x.enabled, x.notes);
  const u = db.prepare('INSERT OR IGNORE INTO unified_categories (slug, name, is_game) VALUES (?, ?, ?)');
  for (const [s, n, g] of UNIFIED) u.run(s, n, g);
  const c = db.prepare(
    'INSERT OR IGNORE INTO categories (platform, store_category_id, name, is_game, parent_store_category_id, unified_slug) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const [id, n, slug, g, parent] of APPLE_GENRES) c.run('ios', id, n, g, parent, slug);
  for (const [id, n, slug, g] of PLAY_CATEGORIES) c.run('android', id, n, g, id === 'GAME' ? null : id.startsWith('GAME_') ? 'GAME' : null, slug);
}
