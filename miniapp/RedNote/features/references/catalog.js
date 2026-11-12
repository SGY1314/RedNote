const REFERENCES = [
  {
    id: 'cafe', file: 'cafe-v1.jpg', title: '把下午留给一杯咖啡',
    body: '想把一个慢下来的下午，留给咖啡和面包。\n\n一份探店记录，可以从杯子里的香气、面包的口感和窗边的光线写起，再补充店名、位置和自己的真实感受。\n\n比起统一的推荐，更想留下属于自己的那一刻。',
    topics: ['咖啡时光', '探店记录', '日常分享'],
  },
  {
    id: 'sichuan', file: 'sichuan-v1.jpg', title: '一顿家常菜里的烟火气',
    body: '热菜、米饭和围坐的一桌人，是值得记录的日常。\n\n写一份自己的用餐记录：实际点过哪些菜，口味、份量和价格如何，有没有下次还想再点的一道。\n\n补上真实店名和位置，让喜欢相同口味的人多一个参考。',
    topics: ['家常菜', '美食记录', '城市烟火气'],
  },
  {
    id: 'bakery', file: 'bakery-v1.jpg', title: '把面包香装进周末',
    body: '一份面包，一段留给自己的慢时光。\n\n可以从外皮的酥脆、内里的组织和喜欢的搭配开始，记录这次实际买到的味道，再写下店铺位置、购买时间和自己的建议。\n\n把喜欢的日常认真留下来。',
    topics: ['面包日常', '烘焙探店', '周末记录'],
  },
];

function getReference(id) {
  const value = REFERENCES.find(item => item.id === id);
  return value ? { ...value, topics: value.topics.slice() } : null;
}

function referenceCards() {
  return REFERENCES.map(note => ({ id: note.id, title: note.title, summary: note.body.split('\n')[0],
    topics: note.topics.slice(0, 2), coverUrl: `/assets/reference/${note.file}`, mediaCount: 1, isVideo: false, isExample: true }));
}

module.exports = { getReference, referenceCards };
