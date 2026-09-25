// Google News RSS search. No account or API key needed.
const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);

export async function searchNews(query, limit = 3) {
  const url =
    'https://news.google.com/rss/search?' +
    new URLSearchParams({ q: `${query} when:30d`, hl: 'en-IN', gl: 'IN', ceid: 'IN:en' });

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MeeraContentBot)' } });
  if (!res.ok) throw new Error(`Google News returned ${res.status}`);
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, item]) => {
    const source = tag(item, 'source');
    let headline = tag(item, 'title');
    // Google appends " - Publication" to titles; strip it since we store the source separately.
    if (source && headline.endsWith(` - ${source}`)) headline = headline.slice(0, -(source.length + 3));
    const date = new Date(tag(item, 'pubDate'));
    return {
      headline,
      source,
      date: isNaN(date) ? '' : date.toISOString().slice(0, 10),
      link: tag(item, 'link'),
      summary: decode(tag(item, 'description').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '),
    };
  });

  return items;
}
