import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MASTER_SALT_KEY = 'fuin_master_salt';
const VAULT_FILE = FileSystem.documentDirectory + 'fuin.enc';
const SYNC_STATE_KEY = 'fuin_sync_state';

export async function runStorageDiagnostics() {
  const logPrefix = '[VAULT_STORAGE_DIAG]';
  console.log(`${logPrefix} START`);

  const docDir = FileSystem.documentDirectory;
  console.log(`${logPrefix} docDir=${docDir ? 'DEFINED' : 'UNDEFINED'}`);
  if (!docDir) {
    throw new Error('DOCUMENT_DIRECTORY_UNDEFINED');
  }

  // 1. Check parent directory
  let dirInfo = await FileSystem.getInfoAsync(docDir);
  console.log(`${logPrefix} dirExists=${dirInfo.exists}`);
  if (!dirInfo.exists) {
    console.log(`${logPrefix} CREATING_DIR`);
    await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });
    dirInfo = await FileSystem.getInfoAsync(docDir);
    console.log(`${logPrefix} dirCreated=${dirInfo.exists}`);
    if (!dirInfo.exists) {
      throw new Error('FAILED_TO_CREATE_DOC_DIR');
    }
  }

  // 2. TEST A: Minimal test file in vault directory
  const testAPath = docDir + '__fuin_test_a__.tmp';
  const testPayload = 'FUIN_STORAGE_TEST';
  console.log(`${logPrefix} TEST_A_START`);
  await FileSystem.writeAsStringAsync(testAPath, testPayload, { encoding: FileSystem.EncodingType.UTF8 });
  const readA = await FileSystem.readAsStringAsync(testAPath, { encoding: FileSystem.EncodingType.UTF8 });
  if (readA !== testPayload) {
    throw new Error('TEST_A_CORRUPT_READ');
  }
  await FileSystem.deleteAsync(testAPath, { idempotent: true });
  console.log(`${logPrefix} TEST_A_OK`);

  // 3. TEST B: Target path write test with dummy data
  const testBPath = VAULT_FILE + '.diag_b';
  const testBPayload = 'FUIN_DIAG_DUMMY';
  console.log(`${logPrefix} TEST_B_START`);
  await FileSystem.writeAsStringAsync(testBPath, testBPayload, { encoding: FileSystem.EncodingType.UTF8 });
  const readB = await FileSystem.readAsStringAsync(testBPath, { encoding: FileSystem.EncodingType.UTF8 });
  if (readB !== testBPayload) {
    throw new Error('TEST_B_CORRUPT_READ');
  }
  await FileSystem.deleteAsync(testBPath, { idempotent: true });
  console.log(`${logPrefix} TEST_B_OK`);

  console.log(`${logPrefix} COMPLETE_ALL_OK`);
  return true;
}

export async function saveSalt(saltHex) {
  await SecureStore.setItemAsync(MASTER_SALT_KEY, saltHex);
}

export async function loadSalt() {
  return await SecureStore.getItemAsync(MASTER_SALT_KEY);
}

export async function saveVault(encryptedBase64, isNewVault = false) {
  const logPrefix = `[VAULT_STORAGE] [isNewVault=${isNewVault}]`;
  console.log(`${logPrefix} SAVE_START`);

  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('DOCUMENT_DIRECTORY_UNDEFINED');
  }
  const dirInfo = await FileSystem.getInfoAsync(docDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });
  }

  if (isNewVault) {
    try {
      console.log(`${logPrefix} DIRECT_WRITE_START`);
      await FileSystem.writeAsStringAsync(VAULT_FILE, encryptedBase64, { encoding: FileSystem.EncodingType.UTF8 });
      const verify = await FileSystem.getInfoAsync(VAULT_FILE);
      if (!verify.exists) {
        throw new Error('VERIFY_WRITE_NOT_FOUND');
      }
      console.log(`${logPrefix} DIRECT_WRITE_OK`);
      return;
    } catch (e) {
      console.error(`${logPrefix} DIRECT_WRITE_FAILED`, e?.name, e?.code, e?.message);
      throw new Error('DIRECT_WRITE_FAILED: ' + (e?.message || e?.name || String(e)));
    }
  }

  // ATOMIC WRITE FOR UPDATES WITH MULTI-TIER RESILIENCE (Android & iOS)
  const uniqueTempPath = VAULT_FILE + '.' + Date.now() + '.tmp';
  const bakPath = VAULT_FILE + '.bak';

  try {
    console.log(`${logPrefix} ATOMIC_WRITE_START`);
    // 1. Write to temporary file first
    await FileSystem.writeAsStringAsync(uniqueTempPath, encryptedBase64, { encoding: FileSystem.EncodingType.UTF8 });

    const tempInfo = await FileSystem.getInfoAsync(uniqueTempPath);
    if (!tempInfo.exists || tempInfo.size === 0) {
      throw new Error('TEMP_WRITE_VERIFY_FAILED');
    }

    // 2. Safeguard existing vault (use copyAsync so VAULT_FILE remains intact)
    const destInfo = await FileSystem.getInfoAsync(VAULT_FILE);
    if (destInfo.exists) {
      try {
        const bakInfo = await FileSystem.getInfoAsync(bakPath);
        if (bakInfo.exists) {
          try { await FileSystem.deleteAsync(bakPath, { idempotent: true }); } catch {}
        }
        await FileSystem.copyAsync({ from: VAULT_FILE, to: bakPath });
      } catch (bakErr) {
        console.warn(`${logPrefix} Non-fatal pre-write backup warning:`, bakErr?.message);
      }
    }

    // 3. Resilient replace: try moveAsync -> fallback copyAsync -> fallback direct write
    let replaceSuccess = false;

    // Strategy A: Native moveAsync (cleanest atomic rename)
    try {
      if (destInfo.exists) {
        try { await FileSystem.deleteAsync(VAULT_FILE, { idempotent: true }); } catch {}
      }
      await FileSystem.moveAsync({ from: uniqueTempPath, to: VAULT_FILE });
      replaceSuccess = true;
    } catch (moveErr) {
      console.warn(`${logPrefix} Native moveAsync rejected (${moveErr?.message}), trying copyAsync fallback`);
    }

    // Strategy B: Stream copyAsync + delete temp
    if (!replaceSuccess) {
      try {
        await FileSystem.copyAsync({ from: uniqueTempPath, to: VAULT_FILE });
        try { await FileSystem.deleteAsync(uniqueTempPath, { idempotent: true }); } catch {}
        replaceSuccess = true;
      } catch (copyErr) {
        console.warn(`${logPrefix} copyAsync fallback rejected (${copyErr?.message}), trying direct write fallback`);
      }
    }

    // Strategy C: Direct writeAsStringAsync
    if (!replaceSuccess) {
      await FileSystem.writeAsStringAsync(VAULT_FILE, encryptedBase64, { encoding: FileSystem.EncodingType.UTF8 });
      try { await FileSystem.deleteAsync(uniqueTempPath, { idempotent: true }); } catch {}
    }

    // 4. Verification
    const verifyInfo = await FileSystem.getInfoAsync(VAULT_FILE);
    if (!verifyInfo.exists || verifyInfo.size === 0) {
      // Emergency rollback if backup exists
      try {
        const bakInfo = await FileSystem.getInfoAsync(bakPath);
        if (bakInfo.exists) {
          await FileSystem.copyAsync({ from: bakPath, to: VAULT_FILE });
        }
      } catch {}
      throw new Error('TARGET_VERIFY_FAILED');
    }

    // 5. Cleanup
    try { await FileSystem.deleteAsync(uniqueTempPath, { idempotent: true }); } catch {}
    try { await FileSystem.deleteAsync(bakPath, { idempotent: true }); } catch {}

    console.log(`${logPrefix} ATOMIC_WRITE_OK`);
  } catch (e) {
    try { await FileSystem.deleteAsync(uniqueTempPath, { idempotent: true }); } catch (err) {}
    console.error(`${logPrefix} ATOMIC_WRITE_FAILED`, e?.name, e?.code, e?.message);
    throw new Error('ATOMIC_WRITE_FAILED: ' + (e?.message || e?.name || String(e)));
  }
}

export async function loadVault() {
  const info = await FileSystem.getInfoAsync(VAULT_FILE);
  if (!info.exists) return null;
  return await FileSystem.readAsStringAsync(VAULT_FILE, { encoding: FileSystem.EncodingType.UTF8 });
}

export async function clearVault() {
  const info = await FileSystem.getInfoAsync(VAULT_FILE);
  if (info.exists) {
    await FileSystem.deleteAsync(VAULT_FILE);
  }
  try {
    await FileSystem.deleteAsync(BACKUP_DIR, { idempotent: true });
  } catch (e) {}
  try {
    await AsyncStorage.removeItem(SYNC_STATE_KEY);
  } catch (e) {}
  try {
    await SecureStore.deleteItemAsync(MASTER_SALT_KEY);
    await SecureStore.deleteItemAsync('fuin-biometric-key');
    await SecureStore.deleteItemAsync('fuin-biometric-enabled');
    await SecureStore.deleteItemAsync('fuin_lan_paired_device');
    await SecureStore.deleteItemAsync('fuin_lan_pair_key');
    await SecureStore.deleteItemAsync('fuin_lan_port');
    await SecureStore.deleteItemAsync('fuin_lan_addresses');
    await SecureStore.deleteItemAsync('fuin_clip_expire');
    await SecureStore.deleteItemAsync('fuin_clip_hash');
    await SecureStore.deleteItemAsync('fuin_clip_val');
  } catch (e) {}
}

// --- SYNC STATE ---
export async function getSyncState() {
  const stateStr = await AsyncStorage.getItem(SYNC_STATE_KEY);
  if (stateStr) {
    try {
      const state = JSON.parse(stateStr);
      if (typeof state.hasLocalEdits !== 'boolean') {
        state.hasLocalEdits = false;
      }
      return state;
    } catch(e) {}
  }
  return {
    generation: 0,
    snapshotHash: require('@craftzdog/react-native-buffer').Buffer.alloc(32).toString('hex'),
    sessionId: '',
    timestamp: 0,
    hasLocalEdits: false,
  };
}

export async function setSyncState(state) {
  await AsyncStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

// --- BACKUP SYSTEM ---
const BACKUP_DIR = FileSystem.documentDirectory + 'backups/';
const MAX_BACKUPS = 15;

export async function saveVaultBackup(encryptedBase64) {
  try {
    const dirInfo = await FileSystem.getInfoAsync(BACKUP_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
    }
    
    const timestamp = Date.now();
    const backupPath = BACKUP_DIR + `fuin-backup-${timestamp}.enc`;
    await FileSystem.writeAsStringAsync(backupPath, encryptedBase64, { encoding: FileSystem.EncodingType.UTF8 });
    
    const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
    if (files.length > MAX_BACKUPS) {
      const sortedFiles = files.sort((a, b) => {
        const timeA = parseInt(a.replace('fuin-backup-', '').replace('.enc', '')) || 0;
        const timeB = parseInt(b.replace('fuin-backup-', '').replace('.enc', '')) || 0;
        return timeA - timeB; 
      });
      
      const toDelete = sortedFiles.slice(0, files.length - MAX_BACKUPS);
      for (const f of toDelete) {
        await FileSystem.deleteAsync(BACKUP_DIR + f, { idempotent: true });
      }
    }
  } catch (e) {}
}

export async function getVaultBackups() {
  try {
    const dirInfo = await FileSystem.getInfoAsync(BACKUP_DIR);
    if (!dirInfo.exists) return [];
    const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
    return files.map(f => {
      const ts = parseInt(f.replace('fuin-backup-', '').replace('.enc', '')) || 0;
      return { fileName: f, timestamp: ts };
    }).sort((a, b) => b.timestamp - a.timestamp); 
  } catch (e) {
    return [];
  }
}

export async function restoreVaultBackup(fileName) {
  try {
    if (!/^fuin-backup-\d+\.enc$/.test(fileName)) return false;
    const backupPath = BACKUP_DIR + fileName;
    const encryptedBase64 = await FileSystem.readAsStringAsync(backupPath, { encoding: FileSystem.EncodingType.UTF8 });
    await saveVault(encryptedBase64); 
    return true;
  } catch (e) {
    return false;
  }
}

export async function setHasLocalEdits(value) {
  const state = await getSyncState();
  state.hasLocalEdits = !!value;
  await setSyncState(state);
}
