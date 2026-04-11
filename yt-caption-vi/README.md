# YouTube Phụ Đề Việt — Chrome Extension

Dịch phụ đề YouTube sang tiếng Việt, hiển thị **phía trên** phụ đề tiếng Anh gốc — không cần API key.

---

## Cài đặt

1. Mở Chrome → `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Nhấn **Load unpacked**
4. Chọn thư mục `yt-caption-vi`
5. Icon VI đỏ xuất hiện trên thanh công cụ ✓

---

## Cách dùng

1. Mở bất kỳ video YouTube nào
2. Bật phụ đề của YouTube (nhấn phím `C` hoặc nút CC)
3. Phụ đề tiếng Việt (màu vàng) tự động hiện **phía trên** phụ đề tiếng Anh trắng

```
┌─────────────────────────────────────────┐
│                                         │
│            [video đang phát]            │
│                                         │
│   Xin chào mọi người, tôi là Alex      │  ← tiếng Việt (vàng)
│   Hello everyone, I'm Alex             │  ← tiếng Anh gốc (trắng)
└─────────────────────────────────────────┘
```

---

## Không cần API key

Extension dùng endpoint miễn phí của Google Translate — hoạt động ngay mà không cần đăng ký.

Nếu bị giới hạn tốc độ (xem nhiều video liên tiếp), thêm API key trong popup:
- Vào [Google Cloud Console](https://console.cloud.google.com)
- Bật **Cloud Translation API**
- Tạo API Key → dán vào ô trong popup extension

---

## Cấu trúc file

```
yt-caption-vi/
├── manifest.json   Cấu hình extension (MV3)
├── content.js      Theo dõi caption YouTube + dịch + hiển thị overlay
├── overlay.css     Style cho phụ đề tiếng Việt
├── popup.html      Giao diện popup
├── popup.js        Logic popup
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Cách hoạt động

1. `content.js` dùng `MutationObserver` để theo dõi thay đổi trong DOM của YouTube
2. Khi phụ đề thay đổi, lấy text từ `.ytp-caption-segment`
3. Gọi Google Translate API (miễn phí hoặc có key)
4. Hiển thị bản dịch trong `#yt-vi-overlay` ngay phía trên caption gốc
5. Cache kết quả trong session để không dịch lại câu đã dịch

---

## Lưu ý

- Chỉ hoạt động khi phụ đề YouTube được bật (nhấn CC)
- Hoạt động tốt nhất với video có phụ đề tiếng Anh thủ công
- Phụ đề tự động (auto-generated) cũng được hỗ trợ nhưng độ chính xác thấp hơn
