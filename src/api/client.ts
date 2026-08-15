/**
 * 统一 fetch 封装。
 *
 * 职责：拼接基础路径、JSON 序列化、AbortController 超时控制、
 * 把 `{code, data, message}` 信封中 code !== 0 的情况统一抛为 `ApiError`。
 */

import { ApiErrorCode, type ApiResponse } from '@/types/api';

/** 后端基础路径。开发期由 Vite proxy 转发，生产期同源 */
export const API_BASE: string = '/api';

/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS: number = 20000;

/**
 * 统一 API 异常。
 * 调用方通过 `code` 区分错误类型，通过 `message` 直接展示给用户。
 */
export class ApiError extends Error {
  /** 错误码，见 `ApiErrorCode` */
  public readonly code: number;

  /** HTTP 状态码，网络层失败时为 0 */
  public readonly httpStatus: number;

  constructor(code: number, message: string, httpStatus: number = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /** 是否为超时类错误 */
  public get isTimeout(): boolean {
    return this.code === ApiErrorCode.NETWORK_TIMEOUT || this.code === ApiErrorCode.CLIENT_ABORTED;
  }

  /** 是否为认证类错误 */
  public get isAuthFailed(): boolean {
    return this.code === ApiErrorCode.UPSTREAM_AUTH_FAILED;
  }
}

/** 请求可选参数 */
export interface RequestOptions {
  /** 超时毫秒数，默认 20000 */
  timeoutMs?: number;
  /** 外部传入的中止信号，与内部超时信号共同生效 */
  signal?: AbortSignal;
}

/** 构造一个与 fetch 中止行为一致的错误对象 */
function createAbortError(): Error {
  const err: Error = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/**
 * 判断某个异常是否由中止（超时 / 外部取消）引发。
 *
 * 响应体读取阶段被 abort 时，不同运行时抛出的错误类型并不一致：
 * 浏览器多为 `AbortError`（DOMException），Node/undici 下可能被包装成
 * `TypeError: terminated`。因此除了看错误名，只要控制器已经处于 aborted
 * 状态，就一律按中止处理，避免把网络问题误报成「JSON 解析失败」。
 *
 * @param err 捕获到的异常
 * @param signal 本次请求内部控制器的信号
 */
function isAbortLikeError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  const name: string = err instanceof Error ? err.name : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * 让一个「不接受 AbortSignal」的异步操作也能被中止打断。
 *
 * `fetch` 的响应体读取（`response.json()` / `response.text()`）在规范上会随
 * signal abort 而 error 掉 body stream，但这依赖运行时实现；某些代理 / polyfill
 * / 测试替身下 body Promise 会永久挂起。这里用竞速兜底，保证无论如何都能返回。
 *
 * @param work 待保护的异步操作
 * @param signal 中止信号
 * @returns 与 `work` 相同的结果；若在完成前被中止则抛出 `AbortError`
 */
function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // 竞速失败的一方后续若 reject，需提前挂上处理器，避免 unhandledRejection
  void work.catch((): void => undefined);

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  let onAbort: (() => void) | null = null;
  const guard: Promise<never> = new Promise<never>((_resolve, reject): void => {
    onAbort = (): void => {
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return Promise.race<T>([work, guard]).finally((): void => {
    if (onAbort !== null) {
      signal.removeEventListener('abort', onAbort);
    }
  });
}

/**
 * 发起 POST JSON 请求并解包响应信封。
 *
 * @param path 相对 `/api` 的路径，如 `/llm/chat`
 * @param body 请求体对象
 * @param options 超时与中止控制
 * @returns 信封中的 `data` 字段
 * @throws ApiError 网络错误、超时、HTTP 非 2xx、或 code !== 0
 */
export async function postJson<TResponse, TBody extends object = Record<string, unknown>>(
  path: string,
  body: TBody,
  options: RequestOptions = {},
): Promise<TResponse> {
  const timeoutMs: number = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller: AbortController = new AbortController();

  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // 外部信号联动
  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  /** 把中止类异常归一化为「外部取消」或「超时」，两阶段共用 */
  const toAbortApiError = (): ApiError => {
    if (options.signal?.aborted) {
      return new ApiError(ApiErrorCode.CLIENT_ABORTED, '请求已取消');
    }
    return new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `请求超时（${timeoutMs}ms）`);
  };

  // 整个流程（fetch + 响应体读取）都在超时保护内，清理放到最后统一执行
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (isAbortLikeError(err, controller.signal)) {
        // 区分「外部主动取消」与「内部超时」
        throw toAbortApiError();
      }
      const detail: string = err instanceof Error ? err.message : String(err);
      throw new ApiError(ApiErrorCode.NETWORK_UNREACHABLE, `网络请求失败：${detail}`);
    }

    // HTTP 层失败（后端理论上都返回 200 + 信封，这里做防御；
    // L6：404 也统一按非 2xx 处理，避免放行后把 HTML 错误页误报为「不是合法 JSON」）
    if (!response.ok) {
      let text: string = '';
      try {
        text = await raceWithAbort(response.text(), controller.signal);
      } catch (err: unknown) {
        // 读 body 时被超时打断 → 与 fetch 阶段超时归一化为同一类错误
        if (isAbortLikeError(err, controller.signal)) {
          throw toAbortApiError();
        }
        text = '';
      }
      throw new ApiError(
        ApiErrorCode.UNKNOWN,
        `服务响应异常（HTTP ${response.status}）${text ? '：' + text.slice(0, 200) : ''}`,
        response.status,
      );
    }

    let envelope: ApiResponse<TResponse>;
    try {
      envelope = (await raceWithAbort(response.json(), controller.signal)) as ApiResponse<TResponse>;
    } catch (err: unknown) {
      // 同上：body 永不结束 / 中途被 abort 属于网络超时，而非 JSON 格式问题
      if (isAbortLikeError(err, controller.signal)) {
        throw toAbortApiError();
      }
      throw new ApiError(ApiErrorCode.UNKNOWN, '服务返回的不是合法 JSON', response.status);
    }

    if (envelope === null || typeof envelope !== 'object' || typeof envelope.code !== 'number') {
      throw new ApiError(ApiErrorCode.UNKNOWN, '服务返回的响应结构不符合约定', response.status);
    }

    if (envelope.code !== ApiErrorCode.OK) {
      throw new ApiError(envelope.code, envelope.message || '请求失败', response.status);
    }

    if (envelope.data === null) {
      throw new ApiError(ApiErrorCode.UNKNOWN, '服务返回数据为空', response.status);
    }

    return envelope.data;
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * 发起 GET 请求并解包响应信封。
 *
 * @param path 相对 `/api` 的路径，如 `/health`
 * @param options 超时与中止控制
 */
export async function getJson<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  const timeoutMs: number = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // 整个流程（fetch + 响应体读取）都在超时保护内，clearTimeout 放到最后统一执行
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (isAbortLikeError(err, controller.signal)) {
        throw new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `请求超时（${timeoutMs}ms）`);
      }
      const detail: string = err instanceof Error ? err.message : String(err);
      throw new ApiError(ApiErrorCode.NETWORK_UNREACHABLE, `网络请求失败：${detail}`);
    }

    // HTTP 层失败（后端理论上都返回 200 + 信封，这里做防御；
    // L6：404 也统一按非 2xx 处理，避免放行后把 HTML 错误页误报为「不是合法 JSON」）
    if (!response.ok) {
      let text: string = '';
      try {
        text = await raceWithAbort(response.text(), controller.signal);
      } catch (err: unknown) {
        // 读 body 时被超时打断 → 与 fetch 阶段超时归一化为同一类错误
        if (isAbortLikeError(err, controller.signal)) {
          throw new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `请求超时（${timeoutMs}ms）`);
        }
        text = '';
      }
      throw new ApiError(
        ApiErrorCode.UNKNOWN,
        `服务响应异常（HTTP ${response.status}）${text ? '：' + text.slice(0, 200) : ''}`,
        response.status,
      );
    }

    let envelope: ApiResponse<TResponse>;
    try {
      envelope = (await raceWithAbort(response.json(), controller.signal)) as ApiResponse<TResponse>;
    } catch (err: unknown) {
      // body 读取被超时打断 → 与 fetch 阶段超时归一化为同一类错误
      if (isAbortLikeError(err, controller.signal)) {
        throw new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `请求超时（${timeoutMs}ms）`);
      }
      throw new ApiError(ApiErrorCode.UNKNOWN, '服务返回的不是合法 JSON', response.status);
    }

    if (envelope.code !== ApiErrorCode.OK || envelope.data === null) {
      throw new ApiError(envelope.code || ApiErrorCode.UNKNOWN, envelope.message || '请求失败', response.status);
    }

    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把任意异常转换为用户可读的中文提示。
 * 供 store / 组件在 catch 中统一调用。
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
