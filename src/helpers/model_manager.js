/**
 * 模型管理器
 * 负责注册、管理和获取语音识别模型
 * 注意：这不是"进程池"，只是管理模型的注册表，用户选择一个模型使用
 */
class ModelManager {
  constructor(logger = null) {
    this.logger = logger || console;
    this.models = new Map(); // id -> Model 实例
    this.currentModel = null; // 当前使用的模型
  }

  /**
   * 注册模型
   * @param {string} id - 模型ID
   * @param {BaseModel} modelInstance - 模型实例
   */
  register(id, modelInstance) {
    if (this.models.has(id)) {
      this.logger.warn && this.logger.warn(`模型 ${id} 已存在，将被覆盖`);
    }
    this.models.set(id, modelInstance);
    this.logger.info && this.logger.info(`模型已注册: ${id}`);
  }

  /**
   * 获取模型实例
   * @param {string} id - 模型ID
   * @returns {BaseModel} 模型实例
   */
  get(id) {
    const model = this.models.get(id);
    if (!model) {
      throw new Error(`模型未找到: ${id}`);
    }
    return model;
  }

  /**
   * 获取所有可用模型的信息
   * @returns {Array} 模型信息列表
   */
  list() {
    const modelList = [];
    for (const [id, model] of this.models) {
      modelList.push(model.getInfo());
    }
    return modelList;
  }

  /**
   * 设置当前使用的模型
   * @param {string} id - 模型ID
   */
  setCurrent(id) {
    const model = this.get(id);
    this.currentModel = model;
    this.logger.info && this.logger.info(`当前模型设置为: ${id}`);
  }

  /**
   * 获取当前模型
   * @returns {BaseModel} 当前模型实例
   */
  getCurrent() {
    if (!this.currentModel) {
      throw new Error("未设置当前模型");
    }
    return this.currentModel;
  }

  /**
   * 停止所有模型
   */
  async stopAll() {
    const promises = [];
    for (const [id, model] of this.models) {
      if (model.isReady()) {
        this.logger.info && this.logger.info(`停止模型: ${id}`);
        promises.push(model.stop());
      }
    }
    await Promise.all(promises);
  }

  /**
   * 检查模型是否存在
   * @param {string} id - 模型ID
   * @returns {boolean}
   */
  has(id) {
    return this.models.has(id);
  }
}

module.exports = ModelManager;
