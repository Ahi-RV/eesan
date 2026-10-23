function manholeQuery(query) {
  const match = String(query).trim().match(/^(?:(?:MH|MANHOLE)[\s:._-]*)?(\d{2,}(?:[ _-]\d+)*)$/i);
  return match ? match[1].replace(/[ _-]/g, '') : null;
}
function matches(text, number) {
  const hits = [];
  // Split digits are accepted only after an explicit MH/Manhole label.
  const digits = number.split('').join('[ \\t:_-]*');
  const pattern = new RegExp(`(?:MH|MANHOLE)[ \\t:._-]*(${digits})|(${number})`, 'gi');
  for (const match of String(text).matchAll(pattern)) {
    const before = text[match.index - 1] || '', after = text[match.index + match[0].length] || '';
    if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
    if (!match[1] && (/[.]/.test(before) || /[.]/.test(after) && /\d/.test(text[match.index + match[0].length + 1] || ''))) continue;
    // A separated continuation is a longer MH identifier, not this number.
    if (match[1] && /^[ _:-]+\d/.test(text.slice(match.index + match[0].length))) continue;
    hits.push({position:match.index, length:match[0].length, score:match[1] ? 300 : 200});
  }
  return hits;
}
function manholeMatch(page, number) {
  const text = String(page.text || '');
  const hits = matches(text, number);
  if (!hits.length) return null;
  hits.sort((a,b)=>b.score-a.score || a.position-b.position);
  let box = null;
  const words = page.words || [];
  for (let start=0; start<words.length && !box; start++) {
    const group=[];
    for (let end=start; end<Math.min(words.length,start+number.length+2); end++) {
      const word=words[end], previous=group.at(-1);
      if (previous && (Math.abs(word.top-previous.top)>Math.max(4,previous.bottom-previous.top)*.7 || word.x0-previous.x1>Math.max(12,previous.bottom-previous.top)*2 || word.x0<previous.x0)) break;
      group.push(word);
      const candidate=group.map(w=>w.text).join(' ');
      const found=matches(candidate,number);
      if (!found.some(h=>h.position===0 && h.length===candidate.length)) continue;
      const x0=Math.min(...group.map(w=>w.x0)), x1=Math.max(...group.map(w=>w.x1));
      const top=Math.min(...group.map(w=>w.top)), bottom=Math.max(...group.map(w=>w.bottom));
      box={x0,top,width:x1-x0,height:bottom-top,pageWidth:page.pageWidth,pageHeight:page.pageHeight};
      break;
    }
  }
  return {...hits[0], score:hits[0].score+(page.textSource==='pdf'?20:0)+(box?10:0), box};
}
module.exports={manholeQuery,manholeMatch};
