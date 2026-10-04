import { useState } from 'react';
import { ArrowLeft, ExternalLink, Gamepad2, Newspaper } from 'lucide-react';
import type { Game } from './types';
import './game-detail.css';

function value(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '未取得' : String(value);
}

function sourceName(url: string) {
  try {
    const host = new URL(url).hostname;
    if (host === 'store.steampowered.com') return 'Steam';
    if (host === 'apps.apple.com') return 'App Store';
    if (host === 'sj.qq.com') return '腾讯应用宝';
    if (host === 'www.taptap.cn') return 'TapTap';
    if (host === 'play.google.com') return 'Google Play';
    return host;
  } catch { return '未录入'; }
}

function DetailCover({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  const url = game.steamAppId ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg` : '';
  return <div className="detail-cover">{url && !failed ? <img src={url} alt={`${game.name} 封面`} onError={() => setFailed(true)} /> : <Gamepad2 size={42} />}</div>;
}

export default function GameDetail({ game, loading, onBack }: { game?: Game; loading: boolean; onBack: () => void }) {
  if (!game) return <div className="game-detail"><button className="detail-back" onClick={onBack}><ArrowLeft size={16} /> 返回可视化分析</button><div className="detail-missing">{loading ? '正在加载游戏档案...' : '没有找到这款游戏，记录可能已删除或链接已失效。'}</div></div>;
  const steam = sourceName(game.sourceUrl) === 'Steam';
  const apple = sourceName(game.sourceUrl) === 'App Store';
  const facts = [
    ['产品分类', game.channel], ['游戏类型', game.genre], ['开发商', game.developer], ['发行商', game.publisher],
    ['发行日期', game.releaseDate], ['平台', game.platforms.join('、')], ['商品来源', sourceName(game.sourceUrl)], ['采集日期', game.dataAsOf]
  ];
  return <div className="game-detail">
    <button className="detail-back" onClick={onBack}><ArrowLeft size={16} /> 返回可视化分析</button>
    <div className="detail-heading"><DetailCover game={game} /><div><span className="eyebrow">GAME PROFILE</span><h1>{game.name}</h1>{game.englishName && game.englishName !== game.name && <p>{game.englishName}</p>}<div className="detail-tags"><span>{game.channel}</span>{game.tags.map(tag => <span key={tag}>{tag}</span>)}{game.isDemo && <span>演示记录</span>}</div></div></div>
    <div className="detail-grid"><section className="detail-section"><h2>游戏档案</h2><div className="detail-facts">{facts.map(([label, fact]) => <div key={label}><span>{label}</span><strong>{value(fact)}</strong></div>)}</div></section>
      <section className="detail-section"><h2>产品简介</h2><p className="detail-description">{game.description || '来源尚未提供产品简介。'}</p></section></div>
    {(steam || apple || game.hasLiveData) && <section className="detail-section detail-metrics"><div className="detail-section-heading"><h2>平台指标</h2><span>{steam ? 'Steam 口径' : apple ? 'App Store 美国区口径' : '已采集的公开指标'}</span></div><div className="detail-metric-grid">
      {steam && <><div><span>Steam 中国区售价</span><strong>{game.price === null ? '未取得' : `¥${game.price}`}</strong></div><div><span>好评率</span><strong>{game.rating === null ? '未取得' : `${game.rating}%`}</strong></div><div><span>评价数</span><strong>{game.reviewCount === null ? '未取得' : game.reviewCount.toLocaleString('zh-CN')}</strong></div><div><span>历史峰值在线</span><strong>{game.peakPlayers === null ? '未取得' : game.peakPlayers.toLocaleString('zh-CN')}</strong></div></>}
      {apple && <><div><span>美国区售价</span><strong>{game.sourceExtras?.usPriceUsd == null ? '未取得' : `$${game.sourceExtras.usPriceUsd.toFixed(2)}`}</strong></div><div><span>五星评分</span><strong>{game.sourceExtras?.usRatingOutOf5 == null ? '未取得' : `${game.sourceExtras.usRatingOutOf5} / 5`}</strong></div><div><span>评分数</span><strong>{game.sourceExtras?.usRatingCount == null ? '未取得' : game.sourceExtras.usRatingCount.toLocaleString('zh-CN')}</strong></div></>}
      {game.hasLiveData && <div><span>Steam 采集时在线</span><strong>{game.currentPlayers == null ? '未取得' : game.currentPlayers.toLocaleString('zh-CN')}</strong></div>}
    </div>{game.steamCapturedAt && <p className="detail-timestamp">在线指标采集于 {new Date(game.steamCapturedAt).toLocaleString('zh-CN')}</p>}</section>}
    {!!game.latestSteamNews?.length && <section className="detail-section"><h2><Newspaper size={17} /> 最新公告</h2><div className="detail-news">{game.latestSteamNews.slice(0, 6).map(news => <a key={news.id} href={news.url} target="_blank" rel="noreferrer"><span>{news.title}<small>{new Date(news.publishedAt).toLocaleDateString('zh-CN')}</small></span><ExternalLink size={14} /></a>)}</div></section>}
    <section className="detail-section"><h2>来源与口径</h2><p className="detail-scope">{game.metricScope || '未提供指标口径。'} 空值表示未取得数据，不代表零。</p><div className="detail-links">{game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noreferrer">商品来源 <ExternalLink size={14} /></a>}{game.metricsSourceUrl && <a href={game.metricsSourceUrl} target="_blank" rel="noreferrer">指标来源 <ExternalLink size={14} /></a>}{game.peakSourceUrl && <a href={game.peakSourceUrl} target="_blank" rel="noreferrer">历史峰值来源 <ExternalLink size={14} /></a>}</div></section>
  </div>;
}
