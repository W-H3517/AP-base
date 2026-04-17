# AP MiniProgram

一个基于微信小程序 + 微信云开发的题库答题系统，支持管理员维护题库、用户在线答题、查看做题记录，以及通过云端动态维护首页 / 结果页助手二维码。

GitHub 仓库：

- [https://github.com/W-H3517/AP-base](https://github.com/W-H3517/AP-base)

如果后续需要继续维护或二次开发，可以直接克隆该仓库到本地继续开发。

## 当前功能

- 用户身份同步与管理员权限控制
- 单题录入与题组录入
- 文本题干、图片题干、多图题干
- 独立选项模式与大图选项模式
- 在线答题、交卷判题、做题记录回看
- 管理员删除 / 新增题目
- 管理员在首页“二维码管理”中更换助手二维码
- 首页底部与结果页统一显示云端动态二维码

## 目录结构

### 小程序前端

- `miniprogram/pages/index`
  - 首页，提供在线答题、做题记录、管理员入口，以及底部助手二维码展示
- `miniprogram/pages/question-bank`
  - 题目管理页，管理员可在这里新增 / 删除题目与题组
- `miniprogram/pages/question-practice`
  - 在线答题页与交卷结果页
- `miniprogram/pages/practice-history`
  - 做题记录列表
- `miniprogram/pages/practice-history-detail`
  - 做题记录详情
- `miniprogram/pages/assistant-qr-admin`
  - 二维码管理页，管理员可删除旧二维码并上传新的二维码
- `miniprogram/components/cloudTipModal`
  - 通用提示弹窗组件

### 云函数后端

- `cloudfunctions/userService`
  - 用户身份、集合初始化、小程序码等接口
- `cloudfunctions/questionService`
  - 题库、题组、答题、提交记录相关接口
- `cloudfunctions/assetService`
  - 助手二维码配置与删除 / 保存接口

## 云函数职责

### `userService`

主要提供：

- `getOpenId`
- `getCurrentUser`
- `initCollections`
- `getMiniProgramCode`

### `questionService`

主要提供：

- `listQuestions`
- `listQuestionSummaries`
- `getQuestionDetail`
- `getQuestionGroupDetail`
- `getPracticePaper`
- `getPracticeQuestionDetail`
- `submitPracticePaper`
- `listPracticeSubmissions`
- `getPracticeSubmissionDetail`
- `getPracticeSubmissionQuestionDetail`
- `prepareCreateQuestionDraft`
- `prepareCreateQuestionGroupDraft`
- `appendDraftGroupQuestionIds`
- `cleanupDraftResources`
- `abandonDraft`
- `createQuestion`
- `createQuestionGroup`
- `deleteQuestion`
- `deleteQuestionGroup`

### `assetService`

主要提供：

- `getAssistantQrConfig`
- `deleteAssistantQr`
- `saveAssistantQrConfig`

## 数据库集合

项目当前使用 5 类集合，并按环境自动区分为 `*_dev` / `*_trial` 两套：

- `users`
- `questions`
- `practice_submissions`
- `question_drafts`
- `asset_configs`

实际在云开发控制台中通常会看到：

- `users_dev` / `users_trial`
- `questions_dev` / `questions_trial`
- `practice_submissions_dev` / `practice_submissions_trial`
- `question_drafts_dev` / `question_drafts_trial`
- `asset_configs_dev` / `asset_configs_trial`

## 建议索引

### 必须加

- `users_*`
  - `openid`：唯一索引
- `questions_*`
  - `questionId`：唯一索引
- `practice_submissions_*`
  - `submissionId`：唯一索引
  - `openid`：普通索引
- `asset_configs_*`
  - `assetKey`：唯一索引

### 强烈建议加

- `questions_*`
  - `groupId`：普通索引
- `question_drafts_*`
  - `draftToken + openid`：联合唯一索引

## 开发与部署说明

### 1. 配置云环境

在 `miniprogram/app.js` 中填写可用的云开发环境 ID。

### 2. 上传云函数

在微信开发者工具中上传并部署以下云函数：

- `cloudfunctions/userService`
- `cloudfunctions/questionService`
- `cloudfunctions/assetService`

### 3. 初始化集合

虽然首页已经不再暴露“初始化集合”按钮，但首次接手或新环境部署时，仍需要确保集合已经创建完成。

可以通过调用 `userService.initCollections` 完成初始化，或者在云开发控制台手动创建相关集合。

### 4. 管理员维护题库

管理员进入首页后，可在“管理入口”中点击“题目管理”进入题库维护页面。

当前支持：

- 新增单题
- 新增题组
- 删除单题
- 删除整组题目

当前系统不支持直接编辑已存在题目，若要修改旧题，建议删除后重新创建。

### 5. 管理员更换助手二维码

管理员进入首页后，可在“管理入口”中点击“二维码管理”。

当前二维码更换流程为：

1. 删除当前二维码
2. 上传新的二维码图片

上传成功后：

- 首页底部会显示最新二维码
- 答题完成结果页会显示同一张最新二维码

## 正式上线前必须确认

### 1. 云开发套餐

正式上线前，请确认当前云开发环境至少已经开通最低档套餐。

否则可能出现：

- 云函数调用失败
- 云存储图片无法访问
- 二维码或题目图片无法正常展示

### 2. 云存储权限

请在云开发控制台的“存储”设置页，将权限调整为：

- **所有用户可读，仅创建者可读写**

如果不是这个权限，普通用户可能无法正常看到题目图片和助手二维码。

项目根目录下的 `修改权限示意图.jpg` 可作为交接参考图。

## 数据与接口文档

前后端当前对齐的数据结构与接口约定，统一记录在：

- `FRONTEND_BACKEND_CONTRACT.md`

后续如果重构前端或调整后端接口，建议优先更新这份契约文档，而不是只改页面实现。
