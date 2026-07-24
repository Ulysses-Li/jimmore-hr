import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { auth, db, qs, showToast } from "./app.js";

const loginForm = qs("#loginForm");

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
