-- ============================================================
--  动态车位分布图 —— 车位坐标字段（幂等，可重复执行）
--  适用：本地 PostgreSQL / Aiven PostgreSQL
--  说明：坐标为图纸归一化百分比 (0~100)，nx 从左到右，ny 从上到下
--        由 DXF「新车位图层」编号文字坐标提取，见 scripts/gen-space-coords.js
-- ============================================================

ALTER TABLE parking_spaces
  ADD COLUMN IF NOT EXISTS pos_x NUMERIC(6,2);   -- 横坐标百分比 0~100

ALTER TABLE parking_spaces
  ADD COLUMN IF NOT EXISTS pos_y NUMERIC(6,2);   -- 纵坐标百分比 0~100

COMMENT ON COLUMN parking_spaces.pos_x IS '车位在分布图上的横坐标(百分比 0~100)';
COMMENT ON COLUMN parking_spaces.pos_y IS '车位在分布图上的纵坐标(百分比 0~100)';

-- 完成校验（可选）
-- SELECT COUNT(*) AS 已定位车位 FROM parking_spaces WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL;
