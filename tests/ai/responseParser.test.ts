/**
 * AI 出牌/叫分返回解析（容错优先）。
 *
 * 核心契约：parsePlayResponse / parseBidResponse 在【任何脏输入】下都不得抛异常，
 * 解析失败一律返回 null。本文件重点覆盖围栏包裹、中文引号、截断 JSON、
 * 尾随逗号、别名兼容、牌面字段多形态等脏数据场景。
 */

import { describe, expect, it } from 'vitest';
import { parseBidResponse, parsePlayResponse } from '@/ai/responseParser';

describe('parsePlayResponse · 永不抛异常', () => {
  const dirtyInputs: string[] = [
    '',
    '   ',
    '纯文本没有json',
    '```json\n{"action":"play","cards":["3"]}\n```',
    '好的，我分析一下：{"action":"play","cards":["3"],"reason":"出3"} 希望有帮助',
    '“{"action":"play","cards":["3"]}”',
    '{"action":"play","cards":["3"', // 截断 JSON
    '\u0000 完全乱码',
    '``` 没有闭合围栏 {"action":"play","cards":["3"]}',
    '{"action":"play","cards":["3"],}', // 尾随逗号
    '前后夹带文字 {"action":"pass"} 结束',
  ];

  it('对任何脏输入都不抛异常', () => {
    for (const raw of dirtyInputs) {
      expect(() => parsePlayResponse(raw)).not.toThrow();
    }
  });

  it('空字符串 / 纯空白 / 非字符串返回 null', () => {
    expect(parsePlayResponse('')).toBeNull();
    expect(parsePlayResponse('   ')).toBeNull();
    expect(parsePlayResponse('随便写点什么')).toBeNull();
  });

  it('截断的 JSON 返回 null 而非抛异常', () => {
    expect(parsePlayResponse('{"action":"play","cards":["3"')).toBeNull();
  });
});

describe('parsePlayResponse · 合法解析', () => {
  it('解析带 ```json 围栏的出牌', () => {
    const raw = '```json\n{"action":"play","cards":["3","3","K"],"reason":"出对3带K"}\n```';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3', '3', 'K']);
    expect(r!.reason).toContain('对3');
  });

  it('从散文 + 全角引号包裹中提取 JSON', () => {
    const raw = '“{"action":"play","cards":["3"]}”';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3']);
  });

  it('解析过牌动作', () => {
    const r = parsePlayResponse('{"action":"pass","reason":"没有更大的牌"}');
    expect(r).not.toBeNull();
    expect(r!.action).toBe('pass');
    expect(r!.cards).toEqual([]);
  });

  it('修复未加引号的键名', () => {
    const r = parsePlayResponse('{action:"play","cards":["3"]}');
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3']);
  });

  it('修复尾随逗号', () => {
    const r = parsePlayResponse('{"action":"play","cards":["3","4"],}');
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3', '4']);
  });

  it('兼容中文动作动词（出牌 / 过牌）', () => {
    expect(parsePlayResponse('{"action":"出牌","cards":["3"]}')!.action).toBe('play');
    expect(parsePlayResponse('{"action":"过牌"}')!.action).toBe('pass');
  });

  it('cards 支持逗号 / 空格分隔字符串', () => {
    expect(parsePlayResponse('{"action":"play","cards":"3,3,K"}')!.cards).toEqual(['3', '3', 'K']);
    expect(parsePlayResponse('{"action":"play","cards":"3 3 K"}')!.cards).toEqual(['3', '3', 'K']);
    expect(parsePlayResponse('{"action":"play","cards":"3、3、K"}')!.cards).toEqual(['3', '3', 'K']);
  });

  it('兼容 cards 别名（card / play / tiles / hand / selected）', () => {
    expect(parsePlayResponse('{"card":["3"]}')!.cards).toEqual(['3']);
    expect(parsePlayResponse('{"play":["3"]}')!.cards).toEqual(['3']);
    expect(parsePlayResponse('{"tiles":["3"]}')!.cards).toEqual(['3']);
    expect(parsePlayResponse('{"hand":["3"]}')!.cards).toEqual(['3']);
    expect(parsePlayResponse('{"selected":["3"]}')!.cards).toEqual(['3']);
  });

  it('兼容 action 别名（act / type / decision / move）', () => {
    expect(parsePlayResponse('{"act":"play","cards":["3"]}')!.action).toBe('play');
    expect(parsePlayResponse('{"type":"pass"}')!.action).toBe('pass');
    expect(parsePlayResponse('{"decision":"play","cards":["3"]}')!.action).toBe('play');
    expect(parsePlayResponse('{"move":"pass"}')!.action).toBe('pass');
  });

  it('无 action 字段但有 cards 时推断为出牌', () => {
    const r = parsePlayResponse('{"cards":["3"]}');
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3']);
  });

  it('action=play 但没有任何牌 → 解析失败返回 null', () => {
    expect(parsePlayResponse('{"action":"play"}')).toBeNull();
    expect(parsePlayResponse('{"action":"play","cards":[]}')).toBeNull();
  });

  it('既无 action 也无 cards → 返回 null', () => {
    expect(parsePlayResponse('{"reason":"x"}')).toBeNull();
  });

  it('reason 超过 200 字被截断并加省略号', () => {
    const long = 'x'.repeat(300);
    const r = parsePlayResponse(`{"action":"pass","reason":"${long}"}`);
    expect(r!.reason.length).toBeLessThanOrEqual(201);
    expect(r!.reason.endsWith('…')).toBe(true);
  });
});

describe('parsePlayResponse · 优先取最后一个 JSON 块（C）', () => {
  it('多块文本中，最终结论（最后一块）的 action 生效，而非草稿块', () => {
    // 模型先写草稿 {action:pass}，再自我纠正给出最终 {action:play}
    const raw =
      '我先想一下：{"action":"pass","reason":"草稿：先过牌看看"} ' +
      '重新分析后结论：{"action":"play","cards":["3"],"reason":"还是出3更稳"}';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['3']);
  });

  it('最后一块为 pass、首块为 play 时，落子为 pass（证明取的是最后而非第一）', () => {
    const raw =
      '初步想法：{"action":"play","cards":["3"]} ' +
      '但仔细算牌后发现该过牌：{"action":"pass","reason":"留牌控场"}';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('pass');
    expect(r!.reason).toContain('留牌控场');
  });

  it('围栏包裹（仅末尾一块）+ 前方裸草稿块：仍取最后围栏块', () => {
    const raw =
      '草稿想法：{"action":"pass","reason":"先过牌"} ' +
      '最终决定：```json\n{"action":"play","cards":["K"]}\n```';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('play');
    expect(r!.cards).toEqual(['K']);
  });

  it('仅单块时行为不变（last 与 first 同为一块）', () => {
    const r = parsePlayResponse('前面一堆分析文字 {"action":"pass","reason":"无牌可压"}');
    expect(r).not.toBeNull();
    expect(r!.action).toBe('pass');
  });

  it('最后一块是非法 JSON、首块合法时回退到首块', () => {
    const raw =
      '结论草稿其实是乱的：{"action":"play","cards":["3"' +
      ' 正确结论：{"action":"pass","reason":"过牌"}';
    const r = parsePlayResponse(raw);
    expect(r).not.toBeNull();
    expect(r!.action).toBe('pass');
  });
});

describe('parseBidResponse · 永不抛异常', () => {
  const dirtyInputs: string[] = ['', '   ', '乱码', '{"score":', '\u0000xx', '前后文字 {"score":2} 后面'];

  it('对任何脏输入都不抛异常', () => {
    for (const raw of dirtyInputs) {
      expect(() => parseBidResponse(raw)).not.toThrow();
    }
  });

  it('解析数字叫分', () => {
    const r = parseBidResponse('{"score":2,"reason":"叫2分"}');
    expect(r).not.toBeNull();
    expect(r!.score).toBe(2);
  });

  it('解析中文叫分文本', () => {
    expect(parseBidResponse('{"score":"叫3分"}')!.score).toBe(3);
    expect(parseBidResponse('{"score":"2分"}')!.score).toBe(2);
    expect(parseBidResponse('{"score":"不叫"}')!.score).toBe(0);
    expect(parseBidResponse('{"score":"pass"}')!.score).toBe(0);
  });

  it('非法 / 无数字的叫分文本返回 null', () => {
    expect(parseBidResponse('不是json')).toBeNull();
    expect(parseBidResponse('{"score":"abc"}')).toBeNull();
    expect(parseBidResponse('')).toBeNull();
  });
});
