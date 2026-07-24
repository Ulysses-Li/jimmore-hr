"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Firestore rules enforce attendance ownership and server-only writes", { skip: !emulatorAvailable }, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
  const testEnv = await initializeTestEnvironment({
    projectId: "jimmore-hr-rules-test",
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8") }
  });
  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const { doc, setDoc } = require("firebase/firestore");
      await setDoc(doc(firestore, "users/employee-a"), { role: "employee", isActive: true, department: "工程" });
      await setDoc(doc(firestore, "users/manager-a"), { role: "manager", isActive: true, department: "工程" });
      await setDoc(doc(firestore, "users/manager-b"), { role: "manager", isActive: true, department: "外銷" });
      await setDoc(doc(firestore, "attendance/record-a"), { userId: "employee-a", department: "工程" });
    });
    const { doc, getDoc, setDoc } = require("firebase/firestore");
    const employeeDb = testEnv.authenticatedContext("employee-a").firestore();
    const ownRecord = doc(employeeDb, "attendance/record-a");
    await assertSucceeds(getDoc(ownRecord));
    await assertFails(setDoc(doc(employeeDb, "attendance/forged"), { userId: "employee-a", department: "工程" }));
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("manager-a").firestore(), "attendance/record-a")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("manager-b").firestore(), "attendance/record-a")));
    assert.ok(true);
  } finally {
    await testEnv.cleanup();
  }
});

test("Employee profile bootstrap cannot grant leave balance or elevated role", { skip: !emulatorAvailable }, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
  const testEnv = await initializeTestEnvironment({
    projectId: "jimmore-hr-profile-rules-test",
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8") }
  });
  try {
    const { doc, setDoc, serverTimestamp } = require("firebase/firestore");
    const employeeDb = testEnv.authenticatedContext("new-employee", {
      email: "employee@example.com"
    }).firestore();
    const profileRef = doc(employeeDb, "users/new-employee");
    const safeProfile = {
      name: "新進員工",
      email: "employee@example.com",
      department: "",
      role: "employee",
      annualLeaveHours: 0,
      compensatoryLeaveHours: 0,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await assertSucceeds(setDoc(profileRef, safeProfile));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { deleteDoc } = require("firebase/firestore");
      await deleteDoc(doc(context.firestore(), "users/new-employee"));
    });
    await assertFails(setDoc(profileRef, { ...safeProfile, annualLeaveHours: 56 }));
    await assertFails(setDoc(profileRef, { ...safeProfile, role: "admin" }));
    await assertFails(setDoc(profileRef, { ...safeProfile, email: "other@example.com" }));
  } finally {
    await testEnv.cleanup();
  }
});

test("Privileged browser writes are denied even for administrators", { skip: !emulatorAvailable }, async () => {
  const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
  const testEnv = await initializeTestEnvironment({
    projectId: "jimmore-hr-admin-rules-test",
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8") }
  });
  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { doc, setDoc } = require("firebase/firestore");
      const firestore = context.firestore();
      await setDoc(doc(firestore, "users/admin-a"), {
        role: "admin",
        isActive: true,
        department: "管理部"
      });
      await setDoc(doc(firestore, "users/employee-a"), {
        role: "employee",
        isActive: true,
        department: "工程"
      });
      await setDoc(doc(firestore, "leaveRequests/request-a"), {
        userId: "employee-a",
        department: "工程",
        status: "pending"
      });
    });
    const { doc, setDoc, updateDoc } = require("firebase/firestore");
    const adminDb = testEnv.authenticatedContext("admin-a").firestore();
    await assertFails(updateDoc(doc(adminDb, "users/employee-a"), { role: "admin" }));
    await assertFails(updateDoc(doc(adminDb, "leaveRequests/request-a"), { status: "approved" }));
    await assertFails(setDoc(doc(adminDb, "workSettings/default"), { standardHours: 8 }));
  } finally {
    await testEnv.cleanup();
  }
});
