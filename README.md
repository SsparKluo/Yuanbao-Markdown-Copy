# Yuanbao Markdown Copy

在腾讯元宝网页对话中添加一键复制 Markdown 按钮（含思考过程），支持导出全部或单轮对话内容，便于整理和分享。

## 功能简介

- 在每条对话气泡旁添加“复制MD”按钮，一键复制该轮对话为 Markdown 格式
- 支持导出全部对话为 Markdown，包含用户提问、AI 回复、引用、思考过程等
- 自动处理图片、代码、PDF 等附件链接
- 需点击右上角按钮激活脚本功能

## 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 新建脚本，将本项目 `index.js` 内容粘贴进去并保存
3. 访问 [https://yuanbao.tencent.com/](https://yuanbao.tencent.com/)

## 使用说明

- 进入元宝对话页面，右上角会出现导出按钮
- 点击“全部”可复制全部对话为 Markdown
- 点击“对话”后，每条对话气泡会出现“复制MD”按钮，可单独复制该轮内容

## 鸣谢

部分思路和实现参考了 [腾讯元宝对话导出器 | Tencent Yuanbao Exporter](https://greasyfork.org/zh-CN/scripts/532431-%E8%85%BE%E8%AE%AF%E5%85%83%E5%AE%9D%E5%AF%B9%E8%AF%9D%E5%AF%BC%E5%87%BA%E5%99%A8-tencent-yuanbao-exporter)（by Gao + Gemini 2.5 Pro），并受益于 GitHub Copilot 及 GPT-4.1 的辅助。

