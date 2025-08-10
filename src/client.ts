// import { writeFile } from 'fs/promises';
// import { join } from 'path';

import pino from 'pino';
import WebSocket from 'isomorphic-ws';

import type {
  EditHistoryRequest,
  FolderName,
  HistoryResult,
  ImageContainer,
  ImageRef,
  ImagesResponse,
  ObjectInfoResponse,
  Prompt,
  PromptQueueResponse,
  QueuePromptResult,
  QueueResponse,
  ResponseError,
  SystemStatsResponse,
  UploadImageResult,
  ViewMetadataResponse,
  PromptHistory,
} from './types.js';

// TODO: Make logger customizable
const logger = pino({
  level: 'info',
});

export class ComfyUIClient {
  public host: string;
  public token?: string;
  public clientId: string;
  public historyResult: HistoryResult = {};
  public eventEmitter: (type: string, data: any) => void = () => {};
  public handlers: any;

  protected ws?: any;

  constructor(
    host: string,
    clientId: string,
    token?: string,
    eventEmitter?: (type: string, data: any) => void,
  ) {
    this.host = host;
    this.token = token;
    this.clientId = clientId;
    this.eventEmitter = eventEmitter || (() => {});
    this.handlers = {
      open: [],
      close: [],
      error: [],
      message: [],
    };
  }

  connect() {
    return new Promise<void>(async (resolve, reject) => {
      if (this.ws) {
        await this.disconnect();
      }

      const url = `${this.host.replace('http', 'ws')}/ws?clientId=${
        this.clientId
      }${this.token ? `&token=${this.token}` : ''}`;

      logger.info(`Connecting to url: ${url}`);

      this.ws = new WebSocket(url);

      if (typeof window !== 'undefined') {
        // 设置原生WebSocket事件处理器（每个事件只设置一次）
        this.ws.onopen = (event: any) => {
          this.handlers.open.forEach((cb: any) => cb(event));
        };

        this.ws.onclose = (event: any) => {
          this.handlers.close.forEach((cb: any) => cb(event));
        };

        this.ws.onerror = (event: any) => {
          this.handlers.error.forEach((cb: any) => cb(event));
        };

        this.ws.onmessage = (event: any) => {
          this.handlers.message.forEach((cb: any) => {
            cb(event.data, event.data instanceof Blob);
          });
        };

        // 自定义on方法（支持多次绑定）
        this.ws.on = (event: string, callback: CallableFunction) => {
          if (this.handlers[event]) {
            this.handlers[event].push(callback);
          } else {
            console.error(`Unknown event type: ${event}`);
          }
        };

        this.ws.off = (event: string, callback: CallableFunction) => {
          if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(
              (cb: any) => cb !== callback,
            );
          }
        };
      }

      this.ws.on('open', () => {
        logger.info('Connection open');
        resolve();
      });

      this.ws.on('close', () => {
        logger.info('Connection closed');
      });

      this.ws.on('error', (err: any) => {
        logger.error({ err }, 'WebSockets error');
        reject(err);
        this.eventEmitter('error', err);
      });

      this.ws.on('message', (data: any, isBinary: boolean) => {
        if (isBinary) {
          logger.debug('Received binary data');
        } else {
          logger.debug('Received data: %s', data.toString());
          this.eventEmitter('message', data);
        }
      });
    });
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  async getEmbeddings(): Promise<string[]> {
    const res = await fetch(this.getUrl('/embeddings'), {
      headers: this.getRequestHeaders(),
    });
    const json: string[] | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getExtensions(): Promise<string[]> {
    const res = await fetch(this.getUrl('/extensions'), {
      headers: this.getRequestHeaders(),
    });
    const json: string[] | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async queuePrompt(prompt: Prompt): Promise<QueuePromptResult> {
    const res = await fetch(this.getUrl('/prompt'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.getRequestHeaders(),
      },
      body: JSON.stringify({
        prompt,
        client_id: this.clientId,
      }),
    });

    const json: QueuePromptResult | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  interrupt(): Promise<Response> {
    return fetch(this.getUrl('/interrupt'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.getRequestHeaders(),
      },
    });
  }

  async editHistory(params: EditHistoryRequest): Promise<void> {
    const res = await fetch(this.getUrl('/history'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.getRequestHeaders(),
      },
      body: JSON.stringify(params),
    });
    const json: QueuePromptResult | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }
  }

  async uploadImage(
    image: ArrayBuffer,
    filename: string,
    overwrite?: boolean,
  ): Promise<UploadImageResult> {
    const formData = new FormData();
    formData.append('image', new Blob([image]), filename);

    if (overwrite !== undefined) {
      formData.append('overwrite', overwrite.toString());
    }

    const res = await fetch(this.getUrl('/upload/image'), {
      method: 'POST',
      body: formData,
      headers: this.getRequestHeaders(),
    });
    const json: UploadImageResult | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async uploadMask(
    image: ArrayBuffer,
    filename: string,
    originalRef: ImageRef,
    overwrite?: boolean,
  ): Promise<UploadImageResult> {
    const formData = new FormData();
    formData.append('image', new Blob([image]), filename);
    formData.append('originalRef', JSON.stringify(originalRef));

    if (overwrite !== undefined) {
      formData.append('overwrite', overwrite.toString());
    }

    const res = await fetch(this.getUrl('/upload/mask'), {
      method: 'POST',
      body: formData,
      headers: this.getRequestHeaders(),
    });
    const json: UploadImageResult | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getImage(
    filename: string,
    subfolder: string,
    type: string,
  ): Promise<Blob> {
    const res = await fetch(
      this.getUrl(
        '/view',
        new URLSearchParams({
          filename,
          subfolder,
          type,
        }),
      ),
      {
        headers: this.getRequestHeaders(),
      },
    );

    return await res.blob();
  }

  async viewMetadata(
    folderName: FolderName,
    filename: string,
  ): Promise<ViewMetadataResponse> {
    const res = await fetch(
      this.getUrl(`/view_metadata/${folderName}?filename=${filename}`),
      {
        headers: this.getRequestHeaders(),
      },
    );
    const json: ViewMetadataResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getSystemStats(): Promise<SystemStatsResponse> {
    const res = await fetch(this.getUrl('/system_stats'), {
      headers: this.getRequestHeaders(),
    });
    const json: SystemStatsResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getPrompt(): Promise<PromptQueueResponse> {
    const res = await fetch(this.getUrl('/prompt'), {
      headers: this.getRequestHeaders(),
    });
    const json: PromptQueueResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getObjectInfo(nodeClass?: string): Promise<ObjectInfoResponse> {
    const res = await fetch(
      this.getUrl(`/object_info` + (nodeClass ? `/${nodeClass}` : '')),
      {
        headers: this.getRequestHeaders(),
      },
    );
    const json: ObjectInfoResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async getHistory(
    fetchOptionOrPromptId?: any,
    promptId?: string,
  ): Promise<HistoryResult> {
    // 兼容旧版本调用方式：getHistory(promptId)
    // 如果第一个参数是字符串且第二个参数未定义，说明是旧版本调用
    let fetchOption: any;
    let actualPromptId: string | undefined;

    if (typeof fetchOptionOrPromptId === 'string' && promptId === undefined) {
      // 旧版本调用：getHistory(promptId)
      actualPromptId = fetchOptionOrPromptId;
      fetchOption = undefined;
    } else {
      // 新版本调用：getHistory(fetchOption, promptId)
      fetchOption = fetchOptionOrPromptId;
      actualPromptId = promptId;
    }

    const host = fetchOption ? fetchOption.host : this.host;
    const method = fetchOption ? fetchOption.method : 'get';
    const res = await fetch(
      `${host}/history${actualPromptId ? `/${actualPromptId}` : ''}`,
      {
        method,
        headers: this.getRequestHeaders(),
      },
    );
    const json: HistoryResult | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    this.historyResult = json;

    return json;
  }

  async getQueue(fetchOption: any): Promise<QueueResponse> {
    const host = fetchOption ? fetchOption.host : this.host;
    const method = fetchOption ? fetchOption.method : 'get';
    const res = await fetch(`${host}/queue`, {
      method,
      headers: this.getRequestHeaders(),
    });
    const json: QueueResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  async deleteQueue(id: string): Promise<QueueResponse> {
    const res = await fetch(this.getUrl('/queue'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.getRequestHeaders(),
      },
      body: JSON.stringify({
        delete: id,
      }),
    });
    const json: QueueResponse | ResponseError = await res.json();

    if ('error' in json) {
      throw new Error(JSON.stringify(json));
    }

    return json;
  }

  // async saveImages(response: ImagesResponse, outputDir: string) {
  //   for (const nodeId of Object.keys(response)) {
  //     for (const img of response[nodeId]) {
  //       const arrayBuffer = await img.blob.arrayBuffer();

  //       const outputPath = join(outputDir, img.image.filename);
  //       // @ts-ignore
  //       await writeFile(outputPath, Buffer.from(arrayBuffer));
  //     }
  //   }
  // }

  async getResult(
    fetchOptionOrPrompt: any,
    promptParam?: Prompt,
  ): Promise<PromptHistory> {
    // 兼容旧版本调用方式：getResult(prompt)
    // 如果只有一个参数且是对象类型，说明是旧版本调用
    let fetchOption: any;
    let prompt: Prompt;

    if (promptParam === undefined) {
      // 旧版本调用：getResult(prompt)
      prompt = fetchOptionOrPrompt;
      fetchOption = undefined;
    } else {
      // 新版本调用：getResult(fetchOption, prompt)
      fetchOption = fetchOptionOrPrompt;
      prompt = promptParam;
    }
    const queue = await this.queuePrompt(prompt);
    const promptId = queue.prompt_id;

    return new Promise<PromptHistory>((resolve, reject) => {
      const onMessage = async (data: WebSocket.RawData, isBinary: boolean) => {
        // Previews are binary data
        if (isBinary) {
          return;
        }

        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'executing') {
            const messageData = message.data;
            if (!messageData.node) {
              const donePromptId = messageData.prompt_id;

              logger.info(`Done executing prompt (ID: ${donePromptId})`);

              // Execution is done
              if (messageData.prompt_id === promptId) {
                // Get history
                const historyRes = await this.getHistory(fetchOption, promptId);
                const history = historyRes[promptId];

                // Remove listener
                this.ws?.off('message', onMessage);
                return resolve(history);
              }
            }
          }
        } catch (err) {
          return reject(err);
        }
      };

      // Add listener
      this.ws?.on('message', onMessage);
    });
  }

  async getImages(prompt: Prompt): Promise<ImagesResponse> {
    return new Promise<ImagesResponse>(async (resolve, reject) => {
      try {
        const outputImages: ImagesResponse = {};
        const history = await this.getResult(prompt);

        // Populate output images
        for (const nodeId of Object.keys(history.outputs)) {
          const nodeOutput = history.outputs[nodeId];
          if (nodeOutput.images) {
            const imagesOutput: ImageContainer[] = [];
            for (const image of nodeOutput.images) {
              const blob = await this.getImage(
                image.filename,
                image.subfolder,
                image.type,
              );
              imagesOutput.push({
                blob,
                image,
              });
            }

            outputImages[nodeId] = imagesOutput;
          }
        }
        resolve(outputImages);
      } catch (err) {
        return reject(err);
      }
    });
  }

  private getRequestHeaders() {
    const result: HeadersInit = {};

    if (this.token) {
      result.Authorization = `Bearer ${this.token}`;
    }

    return result;
  }

  private getUrl(
    path: string,
    params: URLSearchParams = new URLSearchParams(),
  ) {
    return `${this.host}${path}${params.size ? `?${params.toString()}` : ''}`;
  }
}
