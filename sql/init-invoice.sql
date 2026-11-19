-- ============================================================
--  发票开取登记 —— 数据库增量脚本（幂等，可重复执行）
--  适用：本地 PostgreSQL / Aiven PostgreSQL
--  执行：在 Aiven SQL Editor 用连接串里的用户执行；本地用具备 DDL 权限的用户执行
--  前提：parking_spaces、owner_info 已存在（见 sql/init-admin.sql）
--
--  包含三项功能：
--    1) 车位表增加开票状态（未开票 / 已开票）
--    2) 业主表增加已开票 / 未开票车位数量统计
--    3) 发票开取登记表（一张发票 = 一个业主 housekey + 多个车位）
-- ============================================================

-- ---------- 1. 车位增加开票状态 ----------
ALTER TABLE parking_spaces
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(20) DEFAULT '未开票';
UPDATE parking_spaces SET invoice_status = '未开票' WHERE invoice_status IS NULL;
CREATE INDEX IF NOT EXISTS idx_ps_invoice_status ON parking_spaces(invoice_status);

-- ---------- 2. 业主信息增加开票统计 ----------
ALTER TABLE owner_info
  ADD COLUMN IF NOT EXISTS invoiced_count INT DEFAULT 0;
ALTER TABLE owner_info
  ADD COLUMN IF NOT EXISTS uninvoiced_count INT DEFAULT 0;
UPDATE owner_info SET invoiced_count = 0 WHERE invoiced_count IS NULL;
UPDATE owner_info SET uninvoiced_count = 0 WHERE uninvoiced_count IS NULL;

-- ---------- 3. 发票开取登记表 ----------
-- space_no 用 VARCHAR(500)：一张发票可对应多个车位，逗号分隔（如 A-140,A-141）
CREATE TABLE IF NOT EXISTS invoice_records (
  invoice_id      SERIAL PRIMARY KEY,
  invoice_no      VARCHAR(50) UNIQUE,          -- 发票号 / 登记单号
  space_no        VARCHAR(500),                -- 车位号（多车位逗号分隔）
  house_key       VARCHAR(30),                 -- 房号组合键
  owner_name      VARCHAR(100),
  phone           VARCHAR(20),
  amount          NUMERIC(12,2) DEFAULT 0,     -- 价税合计额
  invoice_type    VARCHAR(20) DEFAULT '普票',  -- 专票/普票/普票个人
  invoice_code    VARCHAR(50),                 -- 发票代码（选填）
  invoice_number  VARCHAR(50),                 -- 发票号码（选填）
  invoice_date    DATE DEFAULT CURRENT_DATE,   -- 开票日期
  status          VARCHAR(20) DEFAULT '已开票',-- 已开票/已作废
  remarks         TEXT,
  operator        VARCHAR(50),                 -- 操作人
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
-- 兼容先前建过的窄列老表：多车位拼接、长发票号等需要更宽的列
ALTER TABLE invoice_records ALTER COLUMN space_no       TYPE VARCHAR(1000);
ALTER TABLE invoice_records ALTER COLUMN invoice_no     TYPE VARCHAR(100);
ALTER TABLE invoice_records ALTER COLUMN house_key      TYPE VARCHAR(100);
ALTER TABLE invoice_records ALTER COLUMN owner_name     TYPE VARCHAR(200);
ALTER TABLE invoice_records ALTER COLUMN phone          TYPE VARCHAR(50);
ALTER TABLE invoice_records ALTER COLUMN invoice_type   TYPE VARCHAR(50);
ALTER TABLE invoice_records ALTER COLUMN invoice_code   TYPE VARCHAR(100);
ALTER TABLE invoice_records ALTER COLUMN invoice_number TYPE VARCHAR(100);
ALTER TABLE invoice_records ALTER COLUMN status         TYPE VARCHAR(50);
ALTER TABLE invoice_records ALTER COLUMN operator       TYPE VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_inv_space  ON invoice_records(space_no);
CREATE INDEX IF NOT EXISTS idx_inv_house  ON invoice_records(house_key);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoice_records(status);
CREATE INDEX IF NOT EXISTS idx_inv_date   ON invoice_records(invoice_date);

-- ---------- 4. 历史数据回填业主统计 ----------
-- 已开票 = 车位 invoice_status='已开票'；
-- 未开票 = 已售/已核销 且 未开票（作废发票会回退状态，故回填始终以车位状态为准）
UPDATE owner_info o
SET
  invoiced_count = (
    SELECT COUNT(*) FROM parking_spaces p
    WHERE p.house_key = o.house_key AND p.invoice_status = '已开票'
  ),
  uninvoiced_count = (
    SELECT COUNT(*) FROM parking_spaces p
    WHERE p.house_key = o.house_key
      AND p.status IN ('已售','已核销')
      AND COALESCE(p.invoice_status,'未开票') = '未开票'
  );

-- ---------- 5. 应用用户授权（仅当 parkapp 角色存在时）----------
-- Aiven 上应用通常用连接串自带用户（即建表者），无需此处授权；
-- 本地库若使用独立的 parkapp 连库用户，则自动补授权限，避免脚本在本地/Aiven 任一环境报错。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parkapp') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_records TO parkapp;
    GRANT USAGE, SELECT ON SEQUENCE invoice_records_invoice_id_seq TO parkapp;
  END IF;
END
$$;

-- ---------- 完成校验（可选，手动执行查看结果）----------
-- SELECT
--   (SELECT COUNT(*) FROM parking_spaces WHERE invoice_status='已开票') AS 已开票车位,
--   (SELECT COUNT(*) FROM parking_spaces WHERE status IN ('已售','已核销') AND COALESCE(invoice_status,'未开票')='未开票') AS 未开票车位,
--   (SELECT COUNT(*) FROM invoice_records WHERE status='已开票') AS 有效发票数;
