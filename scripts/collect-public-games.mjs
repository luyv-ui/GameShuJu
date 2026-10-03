import { publishPublicGames } from './validate-public-games.mjs';

const steamGames = [
  [413150, '模拟经营'], [1145360, '动作Roguelike'], [367520, '平台动作'],
  [1794680, '生存Roguelike'], [646570, '策略卡牌'], [2379780, '策略卡牌'],
  [1868140, '模拟经营'], [1623730, '生存建造'], [2358720, '动作角色扮演'],
  [1245620, '动作角色扮演'], [1091500, '角色扮演'], [1426210, '合作冒险'],
  [1086940, '角色扮演'], [990080, '合作冒险'], [105600, '生存建造'],
  [255710, '城市建造'], [264710, '解谜'], [620, '解谜'],
  [1203220, '多人竞技'], [1326470, '生存建造'], [1966720, '合作恐怖'],
  [1092790, '策略卡牌'], [427520, '工厂建造'], [578080, '多人竞技'],
  [730, '多人竞技'], [1172470, '多人竞技'],
  [2096610, '射击'], [250900, 'Roguelike'], [588650, '平台动作'],
  [632360, 'Roguelike'], [391540, '角色扮演']
];
const mobileGames = [
  ['Monument Valley', '解谜'], ['Clash of Clans', '策略模拟'],
  ['Candy Crush Saga', '休闲消除'], ['Genshin Impact', '角色扮演'],
  ['Brawl Stars', '多人竞技'], ['Pokémon GO', '位置游戏'],
  ['Subway Surfers', '跑酷'], ['PUBG MOBILE', '多人竞技'],
  ['MARVEL SNAP', '策略卡牌'], ['Royal Match', '休闲消除']
];
const otherStoreGames = [
  ['Minecraft', '生存建造', 'Android', 'https://play.google.com/store/apps/details?id=com.mojang.minecraftpe&hl=en_US'],
  ['Among Us', '多人社交', 'Android', 'https://play.google.com/store/apps/details?id=com.innersloth.spacemafia&hl=en_US'],
  ['Bloodborne', '动作角色扮演', 'PS4', 'https://store.playstation.com/en-us/product/UP9000-CUSA00900_00-BLOODBORNE000000'],
  ['God of War Ragnarök', '动作冒险', 'PS5', 'https://store.playstation.com/en-us/product/UP9000-PPSA08329_00-GOWRAGNAROK00000'],
  ['Forza Horizon 5', '竞速', 'Xbox', 'https://www.xbox.com/en-US/games/forza-horizon-5'],
  ['Halo Infinite', '射击', 'Xbox', 'https://www.xbox.com/en-US/games/halo-infinite'],
  ['The Legend of Zelda: Tears of the Kingdom', '动作冒险', 'Switch', 'https://www.nintendo.com/us/store/products/the-legend-of-zelda-tears-of-the-kingdom-switch/'],
  ['Super Mario Bros. Wonder', '平台动作', 'Switch', 'https://www.nintendo.com/us/store/products/super-mario-bros-wonder-switch/']
];
const fetchedAt = new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'GameIntelligenceResearch/1.0' } });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastError;
}

function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

const games = [];
const failures = [];
for (const [appid, genre] of steamGames) {
  try {
    const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=cn&l=english`;
    const reviewsUrl = `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&language=all&purchase_type=all&num_per_page=0`;
    const detail = (await json(detailUrl))[appid]?.data;
    const summary = (await json(reviewsUrl)).query_summary;
    if (!detail || detail.type !== 'game' || !summary) throw new Error('缺少商品或评价数据');
    const positive = Number(summary.total_positive || 0);
    const negative = Number(summary.total_negative || 0);
    const total = positive + negative;
    const price = detail.is_free ? 0 : detail.price_overview?.initial / 100;
    games.push({
      name: detail.name, englishName: detail.name, genre,
      platforms: ['PC'], releaseDate: date(detail.release_date?.date),
      developer: detail.developers?.join('、') || '', publisher: detail.publishers?.join('、') || '',
      price: Number.isFinite(price) ? price : null,
      rating: total ? Math.round(positive / total * 100) : null,
      reviewCount: total || null, peakPlayers: null,
      tags: (detail.genres || []).map(item => item.description).filter(item => item !== 'Indie').slice(0, 5),
      description: (detail.short_description || '').replace(/<[^>]*>/g, '').slice(0, 500),
      steamAppId: appid, sourceUrl: `https://store.steampowered.com/app/${appid}/`,
      metricsSourceUrl: reviewsUrl, dataAsOf: fetchedAt.slice(0, 10),
      metricScope: 'Steam 全语言全部购买类型评价；中国区人民币原价（不含限时折扣）', isDemo: false
    });
  } catch (error) { failures.push({ source: `Steam ${appid}`, error: String(error) }); }
  await sleep(350);
}

for (const [title, genre] of mobileGames) {
  try {
    const result = await json(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=software&country=us&limit=25`);
    const item = result.results.find(value => (value.trackName.toLocaleLowerCase() === title.toLocaleLowerCase() || (title === 'Genshin Impact' && value.trackName.startsWith('Genshin Impact ')) || (title === 'MARVEL SNAP' && value.trackName.startsWith('MARVEL SNAP '))) && value.primaryGenreName === 'Games');
    if (!item) throw new Error('未找到准确匹配的美国区游戏商品');
    games.push({
      name: title, englishName: item.trackName, genre,
      platforms: ['iOS'], releaseDate: date(item.releaseDate),
      developer: item.artistName || '', publisher: item.artistName || '',
      price: null, rating: null, reviewCount: null, peakPlayers: null,
      tags: (item.genres || []).filter(value => value !== 'Games').slice(0, 5),
      description: (item.description || '').slice(0, 500),
      steamAppId: null, sourceUrl: item.trackViewUrl,
      metricsSourceUrl: '', dataAsOf: fetchedAt.slice(0, 10),
      metricScope: 'Apple App Store 美国区商品；评分与 Steam 好评率口径不同，未合并', isDemo: false,
      sourceExtras: { appStoreId: item.trackId, usPriceUsd: item.price, usRatingOutOf5: item.averageUserRating || null, usRatingCount: item.userRatingCount || null }
    });
  } catch (error) { failures.push({ source: `App Store ${title}`, error: String(error) }); }
  await sleep(350);
}

for (const [name, genre, platform, sourceUrl] of otherStoreGames) {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok || !(await response.text()).toLocaleLowerCase().includes(name.toLocaleLowerCase())) {
      throw new Error('官方商品页面未验证通过');
    }
    games.push({
      name, englishName: name, genre, platforms: [platform], releaseDate: '',
      developer: '', publisher: '', price: null, rating: null, reviewCount: null, peakPlayers: null,
      tags: [], description: '', steamAppId: null, sourceUrl, metricsSourceUrl: '',
      dataAsOf: fetchedAt.slice(0, 10), metricScope: '官方商店商品页面；未采集可比价格和市场指标', isDemo: false
    });
  } catch (error) { failures.push({ source: `${platform} ${name}`, error: String(error) }); }
  await sleep(350);
}

const document = {
  title: '公开游戏情报样本', fetchedAt,
  methodology: '人工选取跨类型的 Steam PC、美国区 iOS、Google Play Android 和主机官方商店样本；非随机、非全量。Steam 评价为公开评论汇总，好评率=好评数/(好评数+差评数)。Steam 中国区原价可能随地区与时间变化。其他商店仅核验商品页面，未取得可比指标的字段写 null。',
  sources: ['Steam 商店公开商品与评论接口', 'Apple iTunes Search API（美国区）', 'Google Play、PlayStation、Xbox 与 Nintendo 官方商品页面'],
  limitations: ['样本不能推断全球市场份额或收入', '不含非公开销量/收入及完整区域/平台覆盖', 'App Store 星级评分与 Steam 好评率不可直接比较', 'Steam 在线峰值未采集'],
  games, failures
};
if (failures.length) {
  console.error(`采集失败 ${failures.length} 款，未发布快照`, failures);
  process.exitCode = 1;
} else {
  const filename = await publishPublicGames(document, 'data/imports', {
    expectedCount: steamGames.length + mobileGames.length + otherStoreGames.length
  });
  console.log(`收集 ${games.length} 款；快照：${filename}`);
}
