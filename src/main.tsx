/**
 * React 应用入口。
 * 挂载根组件到 `#root`。
 */

import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { installLLMDrivers } from './ai';
import './index.css';

// 把 LLM 驱动器注入 gameStore（T05 → T04 的唯一接线点）。
// 必须在渲染前执行：gameStore 默认使用本地兜底驱动，
// 不调用本函数则 AI 永远不会真正请求大模型。
installLLMDrivers();

const container: HTMLElement | null = document.getElementById('root');

if (container === null) {
  throw new Error('未找到挂载点 #root，请检查 index.html');
}

const root: Root = createRoot(container);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
