# AP MiniProgram

一个基于微信小程序 + 微信云开发的题库管理项目，当前支持：

- 用户身份同步与管理员权限控制
- 单题录入与关联题录入
- 文本题干、图片题干、多图题干
- 独立选项模式与大图选项模式
- 题目浏览、详情查看、管理员新增/编辑/删除

## 当前目录说明

### 小程序前端

- [miniprogram](D:/CP/AP-MiniProgram/miniprogram)
  - 小程序前端代码目录
- [miniprogram/pages/index](D:/CP/AP-MiniProgram/miniprogram/pages/index)
  - 首页，负责同步当前用户、初始化集合、进入题库页面
- [miniprogram/pages/question-bank](D:/CP/AP-MiniProgram/miniprogram/pages/question-bank)
  - 题库主页面，负责题目列表、详情、单题编辑、关联题编辑
- [miniprogram/components/cloudTipModal](D:/CP/AP-MiniProgram/miniprogram/components/cloudTipModal)
  - 通用提示弹窗组件

### 云函数后端

- [cloudfunctions/questionService](D:/CP/AP-MiniProgram/cloudfunctions/questionService)
  - 题目、题组、题库相关接口
- [cloudfunctions/userService](D:/CP/AP-MiniProgram/cloudfunctions/userService)
  - 用户身份、集合初始化、二维码等接口

## 云函数职责

### `questionService`

负责以下动作：

- `listQuestions`
- `getQuestionDetail`
- `getQuestionGroupDetail`
- `createQuestion`
- `updateQuestion`
- `createQuestionGroup`
- `updateQuestionGroup`
- `deleteQuestion`

### `userService`

负责以下动作：

- `getOpenId`
- `getCurrentUser`
- `initCollections`
- `getMiniProgramCode`

## 数据与接口文档

当前前后端已经对齐的数据格式与动作名，统一记录在：

- [FRONTEND_BACKEND_CONTRACT.md](D:/CP/AP-MiniProgram/FRONTEND_BACKEND_CONTRACT.md)

后续如果重构前端，建议以这份文档为准，不要直接从页面实现里反推字段。

## 开发说明

### 1. 配置云环境

在 [app.js](D:/CP/AP-MiniProgram/miniprogram/app.js) 中配置可用的云开发环境 ID。

### 2. 上传云函数

需要在微信开发者工具中分别上传：

- `cloudfunctions/questionService`
- `cloudfunctions/userService`

### 3. 初始化集合

启动小程序后，在首页点击“初始化集合”。

当前默认会使用以下集合：

- `users`
- `questions`

建议在云开发控制台中额外配置唯一索引：

- `users.openid`
- `questions.questionId`

## 当前状态说明

- 后端已按领域拆分云函数，不再使用旧的 `quickstartFunctions`
- 前端目前仍可直接适配当前后端接口
- 前端页面代码后续可以继续单独重构，只要保持接口契约不变即可
