// 通用提示
export const MSG_NEED_INIT = '请私聊 bot 用 /start 初始化';
export const MSG_PRIVATE_ONLY = '请私聊我使用 /start';
export const MSG_GROUP_ONLY = '仅群聊可用';
export const MSG_PRIVATE_OR_GROUP_ONLY = '仅群聊或私聊可用';

// /tzm 相关
export const MSG_TZM_USAGE = '用法：/tzm 明天下午五点';
export const MSG_TZM_SINGLE_POINT_ONLY = '仅支持单次时间点';
export const MSG_TZM_PARSE_FAILURE = '解析失败：请用更具体的表达，例如：/tzm 明天下午五点';
export const MSG_TZM_LOW_CONFIDENCE = '（低置信度）';

// callback / 时区设置
export const MSG_EXPIRED = '消息已过期，请重新 /start';
export const MSG_INVALID_ACTION = '操作无效，请重新选择';
export const MSG_CHOOSE_REGION = '请选择区域';
export const MSG_USER_MISSING = '用户信息缺失，请重试';
export const MSG_TIMEZONE_SET_DONE = '时区设置完成：{tz}';
export const MSG_TIMEZONE_SAVED = '时区已保存';
export const MSG_RETRY_LATER = '处理失败，请稍后重试';

// 时区键盘按钮
export const MSG_PREV_PAGE = '上一页';
export const MSG_NEXT_PAGE = '下一页';
export const MSG_BACK_REGION = '返回区域';
export const MSG_NO_TIMEZONES_IN_REGION = '区域 {region} 暂无可用时区，请返回重新选择区域。';
export const MSG_CHOOSE_TIMEZONE_PAGE = '请选择时区\n区域：{region}\n第 {page}/{total} 页';

// 展示 / 截断
export const MSG_NO_MEMBERS = '本群暂无已登记且被识别的成员';
export const MSG_TRUNCATED = '（已截断，剩余成员未显示）';
export const MSG_TRUNCATED_COUNT = '（已截断，剩余 {n} 人未显示）';
export const MSG_PARSED_AS = '解析为：';

// 时间格式化
export const MSG_UNABLE_TO_CALC_OFFSET = '无法计算时区偏移: {tz}';
export const MSG_INVALID_TIMEZONE = '无效时区: {tz}';
