LƯU Ý CHO TRIỂN KHAI CHỈ BẰNG TRÌNH DUYỆT: Đọc HUONG-DAN-TREN-WEB.md trước. Các lệnh CLI ở dưới là phương án khác, bạn KHÔNG CẦN chạy chúng.

---

# CINEBOX 🎬 — Website xem phim mới

**Giao diện phim + trang quản trị + upload Google Drive + quảng cáo Adsterra**, trong **một repository GitHub**, triển khai như **một Cloudflare Worker** (static assets + API). Không sử dụng chung repository hay hệ thống của web DTCOM cũ.

> Đây là mã nguồn hoàn chỉnh để tự triển khai, **chưa được kết nối với các tài khoản thật** và **chưa được thử tải video thực tế**. Các video chỉ phát được nếu Google Drive cho phép. Chỉ đăng nội dung bạn có quyền phân phối.

## 1. Cấu trúc

```text
cinebox-moi/
├── public/
│   ├── index.html       # Trang chủ xem phim
│   ├── app.js           # Danh sách phim, tìm kiếm, trình xem phim
│   ├── style.css
│   ├── admin.html       # Trang quản trị riêng
│   ├── admin.js         # Quản lý phim, tập phim, upload và quảng cáo
│   ├── admin.css
│   └── assets/          # Banner và 8 poster minh họa tự vẽ
├── src/worker.js        # Backend Cloudflare Worker
├── sql/schema.sql       # Schema D1
├── tests/api.test.js    # Kiểm thử API
├── wrangler.jsonc       # Cấu hình triển khai
├── .github/workflows/deploy.yml
└── HUONG-DAN-TRIEN-KHAI.md
```

## 2. Hoạt động như thế nào?

- Website và trang quản trị được phân phối bằng **Cloudflare Workers Static Assets**; mã nguồn lưu trên **GitHub**.
- **D1** lưu thông tin phim, tập, mã quảng cáo và trạng thái kết nối; **không** lưu file video.
- **Google Drive API** dùng OAuth 2.0 `drive.file` để tạo thư mục `CineBox Phim` trên Drive của bạn và upload video vào đó. Refresh/access token được mã hóa AES-GCM bằng secret `GOOGLE_TOKEN_KEY` trước khi lưu D1.
- Video được upload lên Worker thành **các chunk 4 MiB** bằng Drive resumable upload; không upload vào GitHub. Trình xem public dùng Drive preview iframe.
- Trang quản trị đăng nhập qua cookie HttpOnly, Secure, SameSite=Strict, chữ ký HMAC (12 giờ) + giới hạn thử đăng nhập theo IP trong 15 phút.
- Quảng cáo Adsterra lưu trong trang quản trị. Các banner HTML chạy trong iframe sandbox riêng, Social Bar nhận URL script HTTPS và có thể tắt toàn bộ.

## 3. Cài đặt nhanh (dành cho người đã biết GitHub/Cloudflare)

1. Giải nén và đưa **toàn bộ nội dung bên trong** thư mục `cinebox-moi` lên repository GitHub mới (ví dụ `cinebox-phim`).
2. Cài Node.js 22+, chạy `npm install` và `npx wrangler login` trên máy tính.
3. Chạy `npx wrangler d1 create cinebox-db`, sao chép `database_id` trả về thay chuỗi `PASTE_YOUR_D1_DATABASE_ID_HERE` trong `wrangler.jsonc`.
4. Chạy `npm run db:remote` để tạo bảng D1.
5. Chạy `npm run deploy`. Cloudflare tạo URL dạng `https://cinebox-phim.<subdomain>.workers.dev` (URL thực tế có thể khác tùy tên và tài khoản).
6. Tạo và cài secrets cho Worker:

   ```sh
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_TOKEN_KEY
   ```

   **Mỗi dòng hỏi nhập giá trị bí mật qua terminal, không đưa giá trị vào GitHub.** `SESSION_SECRET` nên có ít nhất 32 ký tự ngẫu nhiên. `GOOGLE_TOKEN_KEY` là 32 byte Base64, tạo bằng:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Tạo mật khẩu đủ mạnh. Giá trị `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` từ Google Cloud Console (bước 7).
7. Google Cloud Console → chọn/tạo project → bật **Google Drive API** → màn hình **Google Auth Platform / OAuth consent** → thêm test user nếu ở chế độ Testing → tạo OAuth Client kiểu **Web application** → đặt **Authorized redirect URI** chính xác:

   ```text
   https://TEN-WORKER.workers.dev/api/admin/google/callback
   ```

   Không dùng URL `dtcom-web.pages.dev`. Dùng URL thực tế mà Worker của bạn được Cloudflare cấp. Sao chép Client ID / Client Secret vào secrets ở bước 6. Nếu bạn thêm secrets sau khi deploy, Worker được cấu hình lại tự động.
8. Mở `https://TEN-WORKER.workers.dev/admin.html` → mật khẩu `ADMIN_PASSWORD` → mục **Cài đặt Google Drive** → **Liên kết tài khoản Google** → cho phép quyền trên Google.
9. Mục **Kho phim** tạo phim → mục **Tải phim lên** chọn phim/tập, tải video lên. Trở về trang chủ để kiểm tra phát.
10. Mục **Quảng cáo Adsterra** dán đúng đoạn mã từ Adsterra cho các vị trí, bật công tắc rồi lưu.

Đọc [HUONG-DAN-TRIEN-KHAI.md](HUONG-DAN-TRIEN-KHAI.md) để xem hướng dẫn chi tiết bằng tiếng Việt.

## 4. GitHub tự động triển khai

`.github/workflows/deploy.yml` tự deploy mỗi lần push nhánh `main`, **sau khi** đặt 2 GitHub Actions secrets ở Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN`: token Cloudflare với quyền deploy Workers và sử dụng D1.
- `CLOUDFLARE_ACCOUNT_ID`: ID tài khoản Cloudflare.

**Nếu chưa tạo hai secrets này, GitHub Actions sẽ báo lỗi dù code không sai.** Có thể tạm xóa file workflow để chỉ deploy thủ công bằng `npm run deploy`, hoặc cấu hình Deploy từ Cloudflare Workers → Builds / Connect GitHub. Không đặt Cloudflare token trong repository.

## 5. Phát phim và giới hạn thật sự của Google Drive

- Video dùng URL nhúng `https://drive.google.com/file/d/FILE_ID/preview` (iframe). Cần file có quyền xem `Anyone with the link / Viewer` để người khác phát. Backend tự thử cấp quyền khi upload xong.
- Google Drive có giới hạn lưu lượng, xử lý video, quota, quyền chia sẻ và có thể từ chối phát/quá băng thông. Một số định dạng như MKV/codec không hỗ trợ có thể tải được nhưng không xem trực tiếp được. **Ưu tiên MP4 H.264 + AAC.**
- Dung lượng mỗi file tối đa trong cấu hình ứng dụng: **25 GB**. Các chunk gửi tới Worker 4 MiB, nhưng tốc độ/độ ổn định và giới hạn của Google/Cloudflare vẫn áp dụng. Không bảo đảm phát liên tục cho lượng truy cập lớn.
- Xóa phim/tập khỏi website **không** xóa file vật lý trong Google Drive. Muốn dọn dung lượng, xóa thủ công trong thư mục `CineBox Phim`.
- Hạn mức tải lên và streaming có thể thay đổi theo loại tài khoản và chính sách Google. Nên dùng dịch vụ video chuyên dụng (Cloudflare Stream, Bunny Stream, R2 + transcoding/HLS) nếu lượng xem lớn.

## 6. Mẹo quản trị

- Đường dẫn quản trị: `/admin.html` hoặc `/admin`.
- Khi chưa có phim thật, trang chủ hiển thị **8 poster minh họa** (nội dung hư cấu, không có video). Ngay khi tạo phim đầu tiên, poster mẫu tự ẩn.
- Có thể thêm tập đã có trên Google Drive bằng **File ID** qua mục "Hoặc gắn phim đã có". Nếu file không do OAuth app tạo ra, app có thể không tự đổi quyền chia sẻ; hãy chỉnh thủ công trong Google Drive.
- Một phim có nhiều tập; mỗi số tập là duy nhất trong phim.
- Muốn ẩn phim khỏi khán giả: bỏ chọn **Hiển thị công khai** trong form sửa phim.
- Poster và backdrop dùng URL hình ảnh HTTPS; không chứa ảnh trong Google Drive nên ảnh hiển thị nhanh hơn. Có sẵn ảnh vector cho dữ liệu minh họa.
- Mã quảng cáo chỉ nên lấy từ Adsterra của bạn. Kiểm tra chính sách Adsterra và luật/quyền đối với phim trước khi mở kiếm tiền.

## 7. Lệnh kiểm tra

```sh
npm run check
npm run dev
npm run db:local
npm run db:remote
npm run deploy
```
Cap nhat CineBox - sua loi trang Admin
Kiểm thử tích hợp hiện có chạy **API với D1 mô phỏng SQLite**, không chạy upload Google thật. Tạo file `.dev.vars` (đã được `.gitignore`) để test OAuth/local; không commit secrets.

**Tài liệu đối chiếu:** https://developers.cloudflare.com/workers/static-assets/ , https://developers.cloudflare.com/d1/ , https://developers.google.com/workspace/drive/api/guides/manage-uploads , https://adsterra.com/blog/how-banner-ads-make-money/ .
