# 版本历史

## 2026-06-01 gps-speed-calibration

- 定位状态显示实时经纬度，地图卡片继续显示 GPS 精度。
- 速度改为优先使用手机系统 GPS speed；无 speed 时用 GPS 坐标差分并加入精度/跳变过滤。
- 导出 CSV/JSON 增加速度来源、GPS 原始速度、高精经纬度、海拔、航向和 GPS 时间戳。
- 校准卡片新增手机俯仰、横滚和前向偏角显示。
- 本地快照保存在 `history/2026-06-01-gps-speed-calibration/`。

说明：当前目录无法创建 `.git`，系统返回 `Operation not permitted`，所以先用源码快照记录本地历史版本。
