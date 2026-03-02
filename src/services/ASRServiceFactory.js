/**
 * ASR 服务工厂
 * 负责创建和管理不同的 ASR 服务实例
 */

import { FunASRService } from './FunASRService';

export const ASRServiceType = {
  FUNASR: 'funasr',
  WHISPER: 'whisper',
  GOOGLE: 'google',
  AZURE: 'azure',
};

/**
 * ASR 服务工厂类
 */
export class ASRServiceFactory {
  static services = new Map();

  /**
   * 注册服务实现
   * @param {string} type - 服务类型
   * @param {class} ServiceClass - 服务类
   */
  static register(type, ServiceClass) {
    this.services.set(type, ServiceClass);
  }

  /**
   * 创建服务实例
   * @param {string} type - 服务类型
   * @param {Object} config - 服务配置
   * @returns {ASRService}
   */
  static create(type, config = {}) {
    const ServiceClass = this.services.get(type);

    if (!ServiceClass) {
      throw new Error(`未知的 ASR 服务类型: ${type}`);
    }

    return new ServiceClass(config);
  }

  /**
   * 获取所有已注册的服务类型
   * @returns {string[]}
   */
  static getAvailableTypes() {
    return Array.from(this.services.keys());
  }

  /**
   * 检查服务类型是否已注册
   * @param {string} type
   * @returns {boolean}
   */
  static isRegistered(type) {
    return this.services.has(type);
  }
}

// 注册默认服务
ASRServiceFactory.register(ASRServiceType.FUNASR, FunASRService);

// 未来可以添加其他服务：
// ASRServiceFactory.register(ASRServiceType.WHISPER, WhisperService);
// ASRServiceFactory.register(ASRServiceType.GOOGLE, GoogleSpeechService);
