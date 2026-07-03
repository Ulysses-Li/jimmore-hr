import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, qs, showToast } from "./app.js";

const loginForm = qs("#loginForm");
const registerForm = qs("#registerForm");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = qs("#loginEmail").value.trim();
  const password = qs("#loginPassword").value;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const userSnap = await getDoc(doc(db, "users", credential.user.uid));
    const role = userSnap.exists() ? userSnap.data().role : "employee";
    location.href = role === "admin" ? "admin/index.html" : "dashboard.html";
  } catch (error) {
    showToast(`登入失敗：${error.message}`, "danger");
  }
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = qs("#registerName").value.trim();
  const email = qs("#registerEmail").value.trim();
  const password = qs("#registerPassword").value;
  const department = qs("#registerDepartment").value.trim();

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "users", credential.user.uid), {
      name,
      email,
      department,
      role: "employee",
      annualLeaveHours: 56,
      compensatoryLeaveHours: 0,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    location.href = "dashboard.html";
  } catch (error) {
    showToast(`註冊失敗：${error.message}`, "danger");
  }
});
