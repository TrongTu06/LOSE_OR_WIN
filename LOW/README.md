# LOSE OR WIN — bản đã sửa

## Cách triển khai (theo đúng thứ tự)

```bash
cd LOSE-OR-WIN
firebase deploy --only database       # đẩy rules MỚI lên trước
firebase deploy --only hosting        # rồi đẩy trang web
```

`.firebaserc` đã ghi sẵn project `lose-or-win-8c507`, không cần `--project` nữa.

## Bước bắt buộc sau khi deploy lần đầu

**Rules phải được deploy TRƯỚC khi mở trang, nếu không đăng ký sẽ lỗi 401.**
Rules cũ trên project của bạn không có node `low-roles` và `low-username-index`,
nên mọi lệnh ghi vào 2 node đó bị root `".write": false` chặn.

Cách nhanh nhất: Firebase Console -> Realtime Database -> tab Rules -> dán toàn bộ
nội dung `database.rules.json` -> Publish.

### Nâng cấp tài khoản đã đăng ký trước đây

Tài khoản cũ chưa có `low-roles/{uid}` nên rules chưa nhận là Chủ Bang:

1. Firebase Console -> Realtime Database -> tạm đặt rules về bản cũ
   (`".read": true`, `".write": "auth != null"`).
2. Mở trang web, đăng nhập bằng tài khoản Chủ Bang.
3. F12 -> tab Console -> gõ: `migrateIndexes()` -> Enter.
4. Dán lại `database.rules.json` -> Publish.
5. Trong `low-users`, xoá node rác `admin: ""`.

Nếu tài khoản cũ không còn cần thiết: xoá sạch `low-users`, `low-roles`,
`low-username-index` trong Console và xoá user trong tab Authentication, rồi đăng ký
lại từ đầu. Người đăng ký đầu tiên tự động thành Chủ Bang.

## Đã sửa những gì

### Lỗi chặn chức năng
- **Mọi lệnh đọc/ghi Realtime Database đều không gửi token đăng nhập.** Chỉ riêng
  `handleRegister` có bản vá tay (`?auth=` viết cứng trong hàm). Vì vậy trang chỉ
  chạy được khi rules mở `".read": true` — siết rules là mọi thao tác lưu sẽ 401.
  Nay có lớp token dùng chung (`getIdToken`) gắn `?auth=` vào mọi lệnh, kèm tự làm
  mới token qua `refreshToken` (idToken hết hạn sau 1 giờ).
- **Token sau khi đăng nhập bị bỏ đi**, phiên chỉ lưu `{username, role}` trong
  localStorage. Nay lưu cả `refreshToken` và `loadSession()` bắt đăng nhập lại nếu
  không còn token hợp lệ.
- **Đăng ký thất bại ở bước ghi DB vẫn để lại tài khoản Auth**, email đó vĩnh viễn
  báo `EMAIL_EXISTS` mà không có hồ sơ để đăng nhập. Nay có rollback: xoá luôn tài
  khoản Auth vừa tạo.
- **`sendRegisterVerificationCode()` là code chết** — tham chiếu `#btn-send-code` và
  `#reg-code-field` vốn không có trong HTML, và gửi email `PASSWORD_RESET` cho email
  chưa có tài khoản rồi bảo người dùng chờ "mã 6 chữ số" mà Firebase không bao giờ
  gửi. Đã xoá.
- **Trùng `id="profile-avatar"`** (2 phần tử). `getElementById` chỉ thấy cái đầu nên
  avatar trong header hồ sơ không bao giờ đổi. Đã bỏ phần tử trùng.
- **Logo trang chủ lấy `src` từ `.sidebar-logo`** — nếu `render()` chưa dựng sidebar
  thì logo trống. Nay trỏ thẳng vào `logo.png`.
- **`--accent-2` (33 lần dùng) và `--line-soft` chưa được định nghĩa** trong `:root`,
  nên mọi viền/gradient dùng chúng render sai âm thầm. Đã thêm.
- **3 font `IBM Plex Sans`, `Space Grotesk`, `Oswald` được gọi khắp CSS nhưng không
  hề nạp.** Đã thêm Google Fonts.
- **Không có `<title>`, favicon, meta description.** Đã thêm.

### Lỗ bảo mật
- Root `".read": true` → ai cũng tải được toàn bộ database (email, điện thoại, quyền,
  dữ liệu HR) bằng một URL. Rules mới yêu cầu đăng nhập.
- `low-users` cho phép mọi người đã đăng nhập ghi đè node của người khác, kể cả tự
  sửa `role` thành `owner`. Rules mới: chỉ ghi được node có `uid` trùng `auth.uid`,
  và `role` chỉ Chủ Bang mới nâng được (dùng `.validate`, vì `.write` ở node con
  **không** chặn được khi node cha đã cho ghi — chỗ này rất dễ viết sai).
- `handleLogin` có nhánh so `u.password !== password` — mật khẩu dạng chữ thường nằm
  trong DB công khai. `saveProfileChanges` còn ghi `account.password = newPassword`.
  Đã bỏ cả hai; rules thêm `"password": { ".validate": false }` để không ghi lại được.
- `console.log('Database loaded:', db)` in toàn bộ tài khoản ra console. Đã xoá.

### Lỗi mất dữ liệu
- `saveUsersDb()` và `saveEmployees()` **PUT đè toàn bộ bảng** từ bản sao trong RAM.
  Hai người lưu cùng lúc là một người mất dữ liệu. 6 chỗ đã đổi sang `PATCH` đúng
  node; `saveUsersDb()` giờ chủ động throw để không ai gọi lại.
- Thành viên thường khi đăng ký thành viên phải ghi đè cả `hr-employees` — nghĩa là
  bất kỳ thành viên nào cũng sửa/xoá được hồ sơ người khác. Nay hồ sơ chờ duyệt ghi
  vào `hr-registrations/{uid}` (chỉ ghi được node của chính mình), được gộp vào danh
  sách khi đọc, và `approveRegistration`/`rejectRegistration` chuyển sang
  `hr-employees` rồi xoá node tạm. `hr-employees` giờ chỉ Chủ Bang ghi được.

### Hiệu năng
- **441 KB ảnh base64 nhúng trong `<script>`** → tách thành `about-1..3.jpg`.
- **Logo PNG 60 KB base64 nằm trong template literal của `render()`** → nhúng lại
  vào DOM mỗi lần render. Tách thành `logo.png`.
- `index.html`: **665 KB → 168 KB**. Ảnh nay được trình duyệt cache (header
  `max-age` 1 năm trong `firebase.json`), thêm `loading="lazy"` cho ảnh kỷ niệm.

### Cấu hình
- `.firebaserc` rỗng `{}` → nay có project mặc định.
- `firebase.json` thiếu `rewrites`, cache header, và khai báo `database.rules`.
- `public/index.html` (bản cũ 4.6 KB) đang bị deploy kèm lên `/public/index.html`.
  Đã xoá.
- Đăng nhập nay nhận **tên đăng nhập hoặc email**. Tên đăng nhập được tra qua
  `low-username-index` (node duy nhất đọc công khai, chỉ chứa map tên → email) vì
  lúc đăng nhập chưa có token để đọc `low-users`.

## Sửa thêm ở bản 2

- **Đăng ký lỗi 401**: `handleRegister` đọc `low-users` *trước khi* đăng nhập để kiểm
  tra trùng tên và xem đã có Chủ Bang chưa. Rules mới yêu cầu auth nên lệnh đọc đó
  luôn trả về rỗng — hậu quả là **mọi người đăng ký sau đều được cấp quyền Chủ Bang**.
  Nay việc kiểm tra trùng tên/email dùng `low-username-index` (node đọc công khai),
  còn quyền được quyết định *sau* khi đã có token bằng cách xem `low-roles` có rỗng
  hay không.
- Thứ tự ghi khi đăng ký đổi thành `low-roles` -> `low-users` -> `low-username-index`,
  vì rules của `low-users` tra quyền trong `low-roles`.
- Rollback khi đăng ký lỗi nay dọn cả `low-roles` và `low-users` đã ghi dở.
- `handleForgotPassword` cũng đọc `low-users` khi chưa đăng nhập -> đã đổi sang chỉ mục.
- Giới hạn ảnh đại diện 2MB ở client không khớp rules (400000 ký tự base64) -> hạ về 280KB.

## Sửa thêm ở bản 3 (tối ưu + dọn project)

- **Chặn ký tự Firebase-key-illegal trong tên đăng nhập** (`. $ # [ ] /`). `low-users`
  vẫn keyed bằng username thô (chưa đổi sang uid — xem mục "chưa làm" #1), nên trước
  đây gõ tên có dấu chấm là đăng ký sẽ tạo xong tài khoản Auth rồi ghi Database thất
  bại (có rollback nên không mất dữ liệu, nhưng lỗi khó hiểu). Nay chặn ngay ở form
  với thông báo rõ ràng.
- **Đổi tên 4 ảnh kỷ niệm** từ tên máy ảnh/app chat (`IMG_2882.jpg`,
  `1I4RR5EF3_8VODM6.jpg`...) sang tên có nghĩa (`memory-2023.jpg`, `memory-2024.jpg`,
  `memory-2025.jpg`, `memory-2025-group.jpg`) và resize xuống tối đa 1400px cạnh dài
  (ảnh gốc 2048–2400px trong khi hiển thị chỉ là thumbnail nhỏ) — giảm ~1MB tổng dung
  lượng ảnh.
- **Tách `index.html` (173 KB, 1 file) thành 3 file** để dễ đọc/sửa và để trình duyệt
  cache CSS/JS riêng khỏi HTML:
  - `index.html` — chỉ còn markup (~11 KB)
  - `css/style.css`
  - `js/app.js` — toàn bộ logic chính
  - `js/init.js` — khởi tạo landing page
  Đã đối chiếu từng phần tách ra khớp 100% với bản gốc, không đổi logic.
- Đối chiếu toàn bộ `onclick`/`oninput`/`onsubmit`/`onchange` trong HTML với danh sách
  hàm JS — không có handler nào gọi hàm chưa định nghĩa.

## Sửa thêm ở bản 4 (xác thực email + sửa key `low-users`)

- **Bật xác thực email khi đăng ký**: đăng ký xong phải bấm link trong email trước khi
  đăng nhập. Nếu đăng nhập sớm, hệ thống tự gửi lại email xác nhận. Đổi email áp dụng
  ngay lập tức; mail "Quên mật khẩu" vẫn là luồng khôi phục riêng.
- **`low-users` chuyển từ key theo *username* sang key theo *uid*** (mục #1 trong
  danh sách "chưa làm" ở bản dưới) — đây là refactor lớn nhất, sửa tận gốc lỗi tên
  đăng nhập có dấu chấm/ký tự đặc biệt làm vỡ key Firebase. Tên đăng nhập giờ không
  còn giới hạn ký tự (`. $ # [ ] /` đều gõ được bình thường). Đã đối chiếu lại toàn
  bộ ~15 chỗ dùng `db[username]` trong `handleLogin`, `handleRegister`, `loadSession`,
  `changeOwnEmail`, `openProfileModal`, `saveProfileChanges`, `submitEmailChange`,
  `refreshUsersCache`, `syncMembershipNotice`,
  `acknowledgeMembershipNotice`, `notifyMembershipRemoval`, chuyển hết sang `uid`.
  Rules trong `database.rules.json` cũng đơn giản hơn hẳn: `low-users/$uid` chỉ so
  `auth.uid === $uid` thay vì phải đọc field `uid` lồng bên trong.
  **Tài khoản đã đăng ký từ trước bản 4 sẽ không đăng nhập được nữa** (vì bản ghi cũ
  còn nằm ở key username) — cần đăng ký lại, hoặc tự copy dữ liệu cũ sang key uid mới
  trong Firebase Console.
- Thêm `escapeHtml()` cho những chỗ tên đăng nhập được chèn vào HTML (danh sách cấp
  quyền), vì tên đăng nhập giờ không còn bị giới hạn ký tự nữa.

## Những việc mình chưa làm, nên làm tiếp

1. **Bật App Check** trong Firebase Console — gói Spark có quota, để hở là dễ bị quét cạn.
   (Việc này cần cấu hình reCAPTCHA/App Check key trong Console, không thể làm hoàn
   toàn qua code — mình để lại cho bạn.)
2. **Ảnh avatar**: tính năng avatar cũ đã được gỡ khỏi giao diện, dữ liệu và Rules vì
  không còn được sử dụng. Hồ sơ tài khoản hiện chỉ lưu các trường cần thiết.
3. **`setInterval` polling 5 giây** cho toàn bộ dữ liệu. Firebase Realtime Database có
   sẵn websocket (`onValue`) qua SDK — nhẹ hơn nhiều so với REST + polling, nhưng đổi
   sang SDK là một refactor lớn khác (thêm SDK, viết lại toàn bộ lớp đồng bộ). Nói nếu
   bạn muốn mình làm tiếp phần này.
4. **4 ảnh kỷ niệm đang là JPEG 170–250 KB**. Nén lại và xuất WebP sẽ giảm thêm dung
   lượng trang chủ.
