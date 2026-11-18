-- ============================================================
--  发票开取登记：表结构初始化 / 迁移（幂等，可重复执行）
--  在应用服务器本地 Postgres 执行（表属主为 postgres）
--  变更后应用用户 parkapp 的授权见文件末尾 GRANT
-- ============================================================

-- ---------- 1. 车位增加开票状态：未开票 / 已开票 ----------
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
CREATE TABLE IF NOT EXISTS invoice_records (
  invoice_id      SERIAL PRIMARY KEY,
  invoice_no      VARCHAR(50) UNIQUE,          -- 发票登记单号 FP001...
  space_no        VARCHAR(20),                 -- 车位号
  house_key       VARCHAR(30),                 -- 房号组合键
  owner_name      VARCHAR(100),
  phone           VARCHAR(20),
  amount          NUMERIC(12,2) DEFAULT 0,     -- 开票金额
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
CREATE INDEX IF NOT EXISTS idx_inv_space  ON invoice_records(space_no);
CREATE INDEX IF NOT EXISTS idx_inv_house  ON invoice_records(house_key);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoice_records(status);
CREATE INDEX IF NOT EXISTS idx_inv_date   ON invoice_records(invoice_date);

-- ---------- 4. 历史数据回填业主统计 ----------
-- 已开票 = 车位 invoice_status='已开票'；未开票 = 已售/已核销且未开票
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

-- ---------- 5. 应用用户授权（应用连库用户 parkapp 非表属主）----------
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_records TO parkapp;
GRANT USAGE, SELECT ON SEQUENCE invoice_records_invoice_id_seq TO parkapp;
-- 新增列随表已有授权生效，无需对 parking_spaces / owner_info 额外 GRANT
