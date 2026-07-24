import { requireAuth, bindLogout, mountPageShell, qs, updateProfileFields, showToast } from "./app.js";

mountPageShell("個人資料", "檢視基本資料與假別餘額");
const profile = await requireAuth();
bindLogout();

qs("#pageContent").innerHTML = `
  <form class="panel p-3" id="profileForm">
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label" for="name">姓名</label>
        <input class="form-control" id="name" value="${profile.name || ""}" required>
      </div>
      <div class="col-md-6">
        <label class="form-label" for="department">部門</label>
        <input class="form-control" id="department" value="${profile.department || ""}" disabled>
        <div class="form-text">部門由管理員維護，避免自行變更審核歸屬。</div>
      </div>
      <div class="col-md-6">
        <label class="form-label">Email</label>
        <input class="form-control" value="${profile.email || ""}" disabled>
      </div>
      <div class="col-md-3">
        <label class="form-label">特休剩餘</label>
        <input class="form-control" value="${profile.annualLeaveHours ?? 0} 小時" disabled>
      </div>
      <div class="col-md-3">
        <label class="form-label">補休剩餘</label>
        <input class="form-control" value="${profile.compensatoryLeaveHours ?? 0} 小時" disabled>
      </div>
    </div>
    <button class="btn btn-primary mt-3">儲存</button>
  </form>`;

qs("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await updateProfileFields(profile.id, {
    name: qs("#name").value.trim()
  });
  showToast("個人資料已更新", "success");
});
