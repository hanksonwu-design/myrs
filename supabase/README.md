# Myrs 接 Supabase 設定指南

網頁版有兩種模式，看 `web/.env.local` 有沒有設定 Supabase 決定：

| | 示範模式（沒設定） | Supabase 模式（有設定） |
|---|---|---|
| 資料存哪裡 | 各自瀏覽器的 localStorage | Supabase 的 Postgres 資料庫，大家共用 |
| 登入 | 示範帳號一鍵登入、驗證碼固定 123456 | Email 或手機簡訊的一次性驗證碼 |
| 點數規則 | 在瀏覽器裡計算 | 在資料庫函式裡計算，使用者改不了 |
| 示範工具（切換帳號、快轉、重設） | 有 | 沒有 |

## 1. 建立專案

1. 到 <https://supabase.com> 註冊，按 **New project**。
2. 區域選 **Northeast Asia (Tokyo)**，離台灣最近。
3. 設一組資料庫密碼並記下來。免費方案就夠試點用。

## 2. 建立資料表和規則

到專案的 **SQL Editor**，依序貼上並執行這三個檔案：

1. `migrations/20261119000001_schema.sql`：資料表、權限（RLS）、所有點數與交易規則。
2. `migrations/20261119000002_storage.sql`：照片儲存空間。刊登照片公開；聊天照片只有交易雙方看得到。
3. `migrations/20261119000003_cron.sql`：每 5 分鐘跑一次逾時取消、自動完成、食品過期。
   - 如果出現 pg_cron 的錯誤，先到 **Database → Extensions** 打開 `pg_cron`，再執行一次。
   - 跳過這一步也能用，網站開著時會自動補跑。

用 Supabase CLI 的話，也可以在 `web/` 執行 `supabase link` 再執行 `supabase db push`。

## 3. 把金鑰填進網站

1. 到 **Project Settings → API** 複製 **Project URL** 和 **anon / publishable key**。
2. 把 `web/.env.example` 複製成 `web/.env.local`，填進去。
3. 重新啟動 `npm run dev`。

anon / publishable key 本來就會放在網頁裡，可以公開。**service_role / secret key 不要放進網站或 Git。**

## 4. 登入設定（Authentication）

**URL Configuration**

- **Site URL** 填網站網址。開發時是 `http://localhost:3000`，上線後改成正式網址。
- **Redirect URLs** 加入 `http://localhost:3000/login` 和正式網址的 `/login`。

**Email 登入（預設就能用）**

- 到 **Email Templates**，在「Magic Link」和「Confirm signup」兩個範本裡加上 `{{ .Token }}`，信裡才會有 6 位數驗證碼。
  - 例如：`<p>你的 Myrs 驗證碼：<b>{{ .Token }}</b></p>`
  - 沒改範本也能登入：用同一個瀏覽器點信中的連結即可。
- Supabase 內建的寄信服務每小時只能寄很少封，只適合測試。試點前請到 **SMTP Settings** 接自己的寄信服務（例如 Resend、SendGrid）。

**手機簡訊登入（文件規劃的正式方式）**

1. 到 **Providers → Phone** 啟用，選簡訊商（Twilio、Vonage、MessageBird 等）並填入帳號。
2. 測試期可以在 **Test Phone Numbers and OTPs** 加入測試號碼，就不會真的寄簡訊。
   - 號碼不加 `+`，例如 `886912345678=123456`。
3. 在 `.env.local` 設定 `NEXT_PUBLIC_LOGIN_METHODS=phone,email`，登入頁就會出現「手機簡訊」分頁。

## 5. 設定第一位管理員

用自己的帳號在網站登入一次並完成註冊（取暱稱），然後在 SQL Editor 執行：

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
-- 用手機註冊的話改成：where phone = '886912345678'
```

重新整理網頁，右上角就會出現「後台」。試點商家可以在後台的「使用者」分頁開通。

## 6. 測試規則

`npm run test:sql` 會在本機用 PGlite 跑一遍 schema，並檢查點數和權限規則，不需要連線到 Supabase。目前有 70 多項檢查，例如：

- 凍結與退點。
- 手續費。
- 每月獎勵上限。
- 盲評。
- 檢舉 3 人自動隱藏。
- 封鎖。
- 逾時取消與自動完成。
- 使用者不能直接改資料表。
- 點數守恆。

### 連線到真的 Supabase 測試

`npm run test:e2e` 會用三個臨時帳號，在真的 Supabase 專案上跑一遍：註冊、上傳照片、刊登、即時通知、交易、聊天照片、完成、盲評。

1. 先到 **Authentication → Sign In / Providers**，暫時打開 **Allow anonymous sign-ins**（允許匿名登入）。測試帳號都用匿名登入建立。
2. 執行 `npm run test:e2e`，最後一行出現 `all checks passed` 就是全部通過。
3. 測完到 **SQL Editor** 貼上並執行 [cleanup_e2e.sql](cleanup_e2e.sql)，刪掉所有測試帳號和它們的資料，最後一行顯示 `0` 就是清乾淨了。真實會員（用 Email 或手機登入的）不受影響。
4. **記得把 Allow anonymous sign-ins 關回去。** 網站本身不使用匿名登入，開著會讓別人不用驗證就能建立帳號。

## 安全設計重點

- 瀏覽器只能「讀」資料表，而且只讀得到自己有權限的列（RLS）。所有寫入都要透過資料庫函式，點數規則在伺服器端執行。
- 點數沒有存「餘額」欄位，餘額一律等於帳本（ledger）加總，方便對帳。
- 公開的刊登只有模糊後的位置（偏移 60～180 公尺）。精確地點存在 `listing_secrets`，只有刊登者、管理員、和被接受的索取者讀得到。
- 手機號碼和 Email 只存在 Supabase Auth，不會出現在任何公開資料表。
- 評價是盲評：雙方都評完，或完成滿 7 天，才會公開。
- 刪除帳號會取消進行中的交易、下架刊登、移除登入資料，只留下「已刪除的使用者」的空殼，讓舊交易紀錄還能顯示。同一個手機或 Email 重新註冊，不會再拿一次新手點數。

## 目前的限制

- 獎勵點數的到期日只記錄、會顯示，還不會真的扣除。要扣除得做先進先出的點數消耗，留到營收版。
- 網頁一次載入使用者看得到的所有資料，大約幾千筆以內都沒問題。超過的話，要改成分頁和伺服器端統計（例如後台儀表板）。
- 管理員在後台看不到使用者的手機號碼。需要客服查詢時，到 Supabase 的 **Authentication → Users** 查。
