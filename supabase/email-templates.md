# 驗證信範本（Supabase → Authentication → Emails）

網站用「驗證碼」登入，信裡一定要有 `{{ .Token }}`。
**Magic Link** 和 **Confirm signup** 兩個範本都要改：舊會員登入用前者，第一次登入的新會員用後者。

## Magic Link

主旨（Subject）：

```
你的 Myrs 登入驗證碼：{{ .Token }}
```

內容（Message body）：

```html
<h2>Myrs 登入驗證碼</h2>
<p>你的驗證碼是：</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>請回到 Myrs 登入頁輸入這組數字，並盡快完成登入。請勿把驗證碼告訴任何人。</p>
<p>如果不是你本人要求登入，請忽略這封信。</p>
```

## Confirm signup

主旨（Subject）：

```
歡迎加入 Myrs！你的驗證碼：{{ .Token }}
```

內容（Message body）：

```html
<h2>歡迎加入 Myrs 你的我的共享平台</h2>
<p>你的驗證碼是：</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>請回到 Myrs 登入頁輸入這組數字完成註冊，註冊就送 50 點。請勿把驗證碼告訴任何人。</p>
<p>如果你沒有申請 Myrs 帳號，請忽略這封信。</p>
```
