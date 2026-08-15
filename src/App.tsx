/**
 * 根组件。
 * 提供路由与全局 Toast 容器。
 */

import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ToastContainer } from './components/common/Toast';

/**
 * 应用根组件。
 * 布局外壳（AppLayout）由路由表统一提供，此处只负责挂载全局能力。
 */
export function App(): JSX.Element {
  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  );
}

export default App;
