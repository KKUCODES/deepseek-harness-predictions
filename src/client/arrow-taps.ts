export const DOUBLE_ARROW_MS = 300

/** 第一次右箭头先等待；第二次到达则取消单次接受，避免先填入草稿再误判双击。 */
export class ArrowTaps {
  private timer?: ReturnType<typeof setTimeout>

  press(single: () => void, double: () => void): void {
    if (this.timer !== undefined) {
      this.cancel()
      double()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      single()
    }, DOUBLE_ARROW_MS)
  }

  cancel(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
