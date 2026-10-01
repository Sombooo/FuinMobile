import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

const TRANSLATIONS = {
  tr: {
    // Lock Screen
    lockMasterLabel: 'ANA ŞİFRE',
    lockNewMasterLabel: 'YENİ ANA ŞİFRE BELİRLEYİN',
    lockMasterPh: 'şifrenizi girin...',
    lockUnlockBtn: 'AÇIK ->',
    lockCreateVaultBtn: 'YENİ KASA OLUŞTUR',
    lockAirGapSyncBtn: "AIR-GAP SYNC (PC'DEN AKTAR)",
    lockForgot: 'şifremi unuttum',
    lockHardReset: 'tüm verileri sıfırla',
    lockConfirmPasswordLabel: 'ŞİFREYİ DOĞRULAYIN',
    lockHintFirstUse: 'İlk kullanımda istediğiniz şifreyi belirleyin.',
    lockHintLocalOnly: 'yalnızca',
    lockHintLocalOnlySuffix: ' bu cihazda saklanır.',
    lockHintPrefix: 'Tüm veriler ',
    recoveryModalTitle: 'KASAYI KURTAR',
    recoveryModalDesc: "Kurulum sırasında size verilen Master Key'i (Kurtarma Anahtarı) giriniz:",
    
    // Alerts
    alertWarning: 'Dikkat',
    alertError: 'Hata',
    alertSuccess: 'Başarılı',
    alertSaved: 'Kaydedildi',
    alertCopied: 'Kopyalandı',
    alertEraseConfirm: 'Telefondaki kasanız tamamen silinecektir. Emin misiniz?',
    hardResetTitle: '⚠ TAM SIFIRLAMA',
    hardResetBody: 'Bu işlem tüm kayıtlarınızı, şifrenizi ve kurtarma anahtarınızı kalıcı olarak siler. Geri alınamaz.',
    hardResetConfirmHint: 'Onaylamak için aşağıya SIFIRLA yazın.',
    hardResetConfirmPh: 'SIFIRLA',
    hardResetBtn: 'Sıfırla',
    hardResetConfirmWord: 'SIFIRLA',
    alertPairingTitle: 'Eşleştirme',
    alertPairingBody: 'Bu işlem, bilgisayarınızdan yeni kasanızı aktarır. QR kodlarını okutabilmek için PC kasanızın şifresi ile telefonunuzun şu anki mevcut şifresinin AYNI olması gerekir.\n\nEğer şifreleriniz farklıysa lütfen "İptal"e basıp, sağ üstten "Çıkış Yap" (Lock) diyerek işlemi Kilit Ekranı üzerinden yapın. Devam edilsin mi?',
    alertRestoreTitle: 'Geri Yükle',
    alertRestoreSuccessRelogin: 'Yedek başarıyla geri yüklendi. Değişikliklerin etkili olması için lütfen çıkış yapıp tekrar giriş yapın.',
    alertRestoreFailed: 'Yedek geri yüklenemedi.',
    alertDecryptFailed: 'Deşifre başarısız. Şifreyi (SyncKey) doğru girdiğinizden emin olun.',
    alertSaveFailed: 'Değişiklikler kaydedilemedi: ',
    alertAreYouSure: 'Emin misin?',
    alertMoveToTrash: 'Bu kayıt çöp kutusuna taşınacaktır.',
    alertPermanentDeleteTitle: 'Kalıcı Olarak Silinecek',
    alertPermanentDeleteMsg: 'Bu kayıt kalıcı olarak silinecektir. Bu işlem geri alınamaz.',
    
    // Buttons
    btnOk: 'Tamam',
    btnCancel: 'İptal',
    btnCancelUpper: 'İPTAL',
    btnDelete: 'Sil',
    btnSave: 'Kaydet',
    btnClose: 'Kapat',
    btnCloseUpper: 'KAPAT',
    btnCopyUpper: 'KOPYALA',
    btnContinue: 'Devam Et',
    btnRecoverUpper: 'KURTAR',
    btnRestoreConfirm: 'Evet, Döndür',
    btnRestoreAction: 'Geri Dön',
    btnGrantPermission: 'İzin Ver',
    btnLogout: 'Çıkış Yap',
    btnDeleteEntry: 'Bu Kaydı Sil',
    btnRestoreEntry: 'Kayıtı Geri Yükle',
    btnDeletePermanently: 'Kalıcı Olarak Sil',
    
    // Toasts
    toastEnterPassword: 'Lütfen şifrenizi girin.',
    toastVaultNotFound: 'Kasa bulunamadı. Lütfen yeni kasa oluşturun.',
    toastWrongPasswordOrCorrupted: 'Kasa şifresi yanlış veya kasa bozuk.',
    toastMin8Chars: 'Ana şifreniz en az 8 karakter olmalıdır.',
    toastPasswordsDoNotMatch: 'Şifreler eşleşmiyor!',
    toastNoRecoveryFound: 'Sistemde kayıtlı bir kurtarma anahtarı bulunamadı.',
    toastPasswordRestored: 'Şifreniz başarıyla geri yüklendi. Giriş yapabilirsiniz.',
    toastInvalidRecoveryKey: 'Geçersiz Kurtarma Anahtarı!',
    toastGenericError: 'Hata oluştu.',
    toastVaultCreateFailed: 'Kasa oluşturulamadı: ',
    toastRecoveryKeyCopied: 'Anahtar kopyalandı!',
    toastJsonExported: 'JSON yedeği kaydedildi.',
    toastCsvExported: 'CSV yedeği seçtiğiniz klasöre kaydedildi.',
    toastCopiedClipboard30s: ' panoya kopyalandı. Güvenlik için 30 saniye sonra silinecektir.',
    toastCopiedClipboard45s: 'Şifre panoya kopyalandı. Güvenlik için 45 saniye sonra silinecektir.',
    toastSiteRequired: 'Platform ve Şifre alanları zorunludur.',
    
    // Biometric
    bioPromptLogin: 'Fuin kasanızı açın',
    bioFallbackLabel: 'Şifre Kullan',
    bioEnablePrompt: 'Biyometrik girişi aktif etmek için onaylayın',
    bioEnabledSuccess: 'Biyometrik giriş aktif edildi.',
    bioNotSupportedOrEnrolled: 'Cihazınızda biyometrik doğrulama bulunmuyor veya ayarlanmamış.',
    bioSectionTitle: 'BİYOMETRİK GİRİŞ',
    bioFingerprintFaceId: 'Parmak İzi / FaceID',
    bioNoPasswordSub: 'Uygulamaya girerken şifre sormaz',
    
    // Navigation / Tabs
    tabVault: 'Kasam',
    tabQrSync: 'QR Sync',
    tabTools: 'Araçlar',
    tabSettings: 'Ayarlar',
    navVault: 'KASAM',
    navTools: 'ARAÇLAR',
    navSettings: 'AYARLAR',
    
    // Categories
    cat_all: 'Hepsi',
    cat_fav: 'Favoriler',
    cat_trash: 'Çöp Kutusu',
    cat_social: 'Sosyal',
    cat_work: 'İş',
    cat_shopping: 'E-Ticaret',
    cat_finance: 'Finans',
    cat_education: 'Eğitim',
    cat_other: 'Diğer',
    
    // Vault Screen
    searchPlaceholderVault: 'Şifre, kullanıcı adı veya kategori ara...',
    emptyCategoryResults: 'Bu kategoride şifre bulunamadı.',
    fieldUser: 'Kullanıcı Adı',
    fieldPassword: 'Şifre',
    
    // Tools
    ioTitle: 'DIŞA / İÇE AKTAR (JSON & CSV)',
    ioExportJsonBtn: '↑ JSON İndir',
    ioExportCsvBtn: '↑ CSV İndir',
    ioImportJsonBtn: '↓ JSON Seç',
    ioImportCsvBtn: '↓ CSV Seç',
    ioExportJsonTitle: 'JSON Yedeğini Kaydet',
    ioExportCsvTitle: 'CSV Yedeğini Kaydet',
    ioExportJsonFailed: 'JSON dışa aktarma başarısız: ',
    ioExportCsvFailed: 'CSV dışa aktarma başarısız: ',
    ioImportFailed: 'İçe aktarma başarısız: ',
    ioItemsImportedSuccess: ' adet öğe başarıyla içe aktarıldı.',
    ioItemsImportedCsvSuccess: ' adet öğe başarıyla içe aktarıldı ve eklendi.',
    ioInvalidJsonError: 'Geçersiz Fuin veya Bitwarden JSON dosyası.',
    ioInvalidCsvEmpty: 'Geçersiz veya boş CSV',
    ioInvalidCsvColumns: 'Geçersiz CSV formatı. Name/Site ve Password sütunları bulunamadı.',
    secToolsTitle: 'GÜVENLİK ARAÇLARI',
    healthReportCardTitle: '◎ Sağlık Raporu (HIBP Sızıntı Taraması)',
    healthReportCardSub: 'Şifrelerinizin veri sızıntılarında olup olmadığını güvenli k-Anonymity ile tarayın.',
    backupsCardTitle: '◎ Sistem Yedekleri (Geri Yükleme)',
    backupsCardSub: 'Otomatik alınan AES-256-GCM kriptografik kasa geçmişinize dönün.',
    
    // Settings
    themeTitle: 'TEMA',
    themeSystem: 'SİSTEM',
    themeDark: 'KOYU',
    themeLight: 'AÇIK',
    langTitle: 'DİL',
    autoLockTitle: 'ARKA PLAN KİLİT SÜRESİ',
    time1m: '1 dk',
    time2m: '2 dk',
    time5m: '5 dk',
    timeNever: 'Asla',
    autoLockSavedMsg: 'Kilit süresi {label} olarak ayarlandı.',
    sysSecurityTitle: 'SİSTEM & GÜVENLİK',
    sysLocalVaultActive: 'Yerel Güvenli Kasa devrede',
    sysCryptoArchitecture: 'Kriptografik Mimari',
    sysCryptoDetails: '• KDF: PBKDF2 (Masaüstü Argon2id destekler)\n• Şifreleme: AES-256-GCM (Authenticated encryption)\n• Anahtarlar: VaultKey + SyncKey (Air-Gap Sync)\n• Hassas veriler sadece bellek (RAM) üzerinde çözülür.',
    lockSessionBtn: 'Oturumu Kapat (Lock)',
    
    // Backup Modal
    backupModalTitle: 'SİSTEM YEDEKLERİ',
    backupModalDesc: 'Her şifre eklediğinizde veya sildiğinizde cihazınız arka planda otomatik olarak kriptografik (AES) bir yedek alır. Dilediğiniz yedeği seçerek kasanızı o anki haline geri döndürebilirsiniz.',
    backupEmpty: 'Henüz hiç yedek alınmamış.',
    dateToday: 'Bugün ',
    alertRestoreBody: ' tarihli yedeğe dönülecek. O anki tüm verileriniz geri gelecek ve şu anki güncel değişiklikleriniz (eğer varsa) silinecek. Onaylıyor musunuz?',
    
    // Health Modal
    healthTitle: 'SAĞLIK RAPORU',
    healthKAnonymityTitle: 'k-Anonymity Teknolojisi',
    healthInfoBox: 'Şifreleriniz hiçbir zaman internete gönderilmez. Sadece SHA-1 hash\'inin ilk 5 karakteri ile sorgu yapılır. Eşleşme tamamen cihazınızda gerçekleşir.',
    healthScanBtn: 'SIZINTI TARAMASINI BAŞLAT',
    healthScanning: 'Taranıyor...',
    healthScanAgain: 'TEKRAR TARA',
    hibpBreachedWarning: ' ŞİFRE SIZDIRILMIŞ!',
    hibpBreachedCount: '× sızdırılmış',
    hibpCleanCongrats: 'TEBRİKLER!',
    hibpAllClean: 'Hiçbir şifreniz bilinen veri sızıntılarında bulunamadı.',
    hibpNetworkError: ' şifre kontrol edilemedi (ağ hatası)',
    hibpCleanCount: ' şifre güvenli',
    hibpUnknown: 'Bilinmeyen',
    
    // Edit Modal
    modalNewEntry: 'YENİ KAYIT',
    modalEditEntry: 'KAYDI DÜZENLE',
    modalDeletedEntry: 'SİLİNMİŞ KAYIT',
    fieldSite: 'PLATFORM / SİTE ADI *',
    fieldSitePh: 'Netflix, Google, vs.',
    fieldCategory: 'KATEGORİ',
    toggleFavLabel: 'FAVORİ',
    fieldUserLabel: 'KULLANICI ADI / E-POSTA',
    fieldPasswordLabel: 'ŞİFRE',
    genPwTitle: 'Üret',
    fieldUrl: 'WEB SİTESİ URL',
    section2FA: '2FA (İKİ AŞAMALI DOĞRULAMA)',
    toggle2FASub: 'TOTP GİZLİ ANAHTARI',
    fieldNote: 'NOTLAR',
    selectCategoryTitle: 'Kategori Seç',
    
    // Generator Modal
    genTitle: 'ŞİFRE ÜRETİCİ',
    genApply: 'Kullan',
    genCancel: 'İptal',
    strengthLabel: 'Güç: ',
    strengthWeak: 'Zayıf',
    strengthMedium: 'Orta',
    strengthStrong: 'Güçlü',
    genLength: 'Karakter Uzunluğu:',
    genUpper: 'A-Z (Büyük Harf)',
    genLower: 'a-z (Küçük Harf)',
    genNum: '0-9 (Rakam)',
    genSym: '!@# (Sembol)',
    genExc: 'Benzerleri Hariç Tut',
    
    // Sync / Camera
    syncTitle: 'AIR-GAP SYNC',
    syncEncrypting: 'Kasa Şifreleniyor...',
    syncChunksCollected: 'Toplanan Parça: ',
    cameraPermissionRequired: 'Kamera izni gerekiyor.',
    alertSyncNeedPassword: 'Sync işlemine başlamadan önce Ana Şifrenizi (SyncKey) girmelisiniz.',
    syncPasswordPromptTitle: 'Lütfen Masaüstünde belirlediğiniz Sync Şifresini girin.',
    syncPasswordPh: 'Senkronizasyon Şifresi',
    syncPassMinLen: 'Sync şifresi en az 10 karakter olmalıdır.',
    syncRetryDelayText: 'Lütfen tekrar denemeden önce bekleyin:',
    syncRetryDelayPrefix: 'Güvenlik gecikmesi:',
    syncMasterPromptTitleExisting: 'Kasa Ana Şifresini Girin',
    syncMasterPromptTitleNew: 'Yeni Kasa Ana Şifresi Belirleyin',
    syncMasterPromptDescExisting: 'İçe aktarılan verileri cihazınızda şifrelemek için Ana Şifrenizi girin.',
    syncMasterPromptDescNew: 'İçe aktarılan verileri cihazınızda korumak için en az 8 karakterli bir Ana Şifre belirleyin.',
    syncMasterPasswordPh: 'Ana Şifre (en az 8 karakter)',
    syncMasterConfirmPh: 'Ana Şifre Tekrar',
    syncImportBtn: 'Kasayı İçe Aktar',
    syncTransferFailed: 'QR aktarımı başarısız oldu. Lütfen tekrar deneyin.',
    
    // Success Screen
    syncSuccessTitle: 'SENKRONİZASYON BAŞARILI',
    syncSuccessSubtitle: 'Kasa şifrelenerek cihazınıza kaydedildi.',
    
    // Recovery
    recoveryCreatedTitle: 'Kasa Oluşturuldu!',
    recoveryCreatedBody: 'Bu kurtarma anahtarını güvenli bir yere kaydedin. Şifrenizi unutursanız kasayı bu anahtarla açabilirsiniz.',
  },
  
  en: {
    // Lock Screen
    lockMasterLabel: 'MASTER PASSWORD',
    lockNewMasterLabel: 'SET A NEW MASTER PASSWORD',
    lockMasterPh: 'enter your password...',
    lockUnlockBtn: 'UNLOCK ->',
    lockCreateVaultBtn: 'CREATE NEW VAULT',
    lockAirGapSyncBtn: 'AIR-GAP SYNC (FROM PC)',
    lockForgot: 'forgot my password',
    lockHardReset: 'erase all data',
    lockConfirmPasswordLabel: 'CONFIRM PASSWORD',
    lockHintFirstUse: 'Choose your password on first use.',
    lockHintLocalOnly: 'only',
    lockHintLocalOnlySuffix: ' on this device.',
    lockHintPrefix: 'All data is stored ',
    recoveryModalTitle: 'RECOVER VAULT',
    recoveryModalDesc: 'Enter the Master Key (Recovery Key) that was given to you during setup:',
    
    // Alerts
    alertWarning: 'Warning',
    alertError: 'Error',
    alertSuccess: 'Success',
    alertSaved: 'Saved',
    alertCopied: 'Copied',
    alertEraseConfirm: 'Your vault on this phone will be completely erased. Are you sure?',
    hardResetTitle: '⚠ FULL RESET',
    hardResetBody: 'This action permanently deletes all your entries, password, and recovery key. This cannot be undone.',
    hardResetConfirmHint: 'Type RESET below to confirm.',
    hardResetConfirmPh: 'RESET',
    hardResetBtn: 'Reset',
    hardResetConfirmWord: 'RESET',
    alertPairingTitle: 'Pairing',
    alertPairingBody: 'This transfers your vault from your computer. To scan the QR codes, the PC vault password and your current phone password must be THE SAME.\n\nIf they differ, press "Cancel" and use "Log Out" (Lock) to do the sync from the Lock Screen. Continue?',
    alertRestoreTitle: 'Restore',
    alertRestoreSuccessRelogin: 'Backup restored successfully. Please log out and log back in for changes to take effect.',
    alertRestoreFailed: 'Backup could not be restored.',
    alertDecryptFailed: 'Decryption failed. Make sure you entered the correct password (SyncKey).',
    alertSaveFailed: 'Changes could not be saved: ',
    alertAreYouSure: 'Are you sure?',
    alertMoveToTrash: 'This entry will be moved to the trash.',
    alertPermanentDeleteTitle: 'Permanent Deletion',
    alertPermanentDeleteMsg: 'This entry will be permanently deleted. This action cannot be undone.',
    
    // Buttons
    btnOk: 'OK',
    btnCancel: 'Cancel',
    btnCancelUpper: 'CANCEL',
    btnDelete: 'Delete',
    btnSave: 'Save',
    btnClose: 'Close',
    btnCloseUpper: 'CLOSE',
    btnCopyUpper: 'COPY',
    btnContinue: 'Continue',
    btnRecoverUpper: 'RECOVER',
    btnRestoreConfirm: 'Yes, Restore',
    btnRestoreAction: 'Restore',
    btnGrantPermission: 'Grant',
    btnLogout: 'Log Out',
    btnDeleteEntry: 'Delete This Entry',
    btnRestoreEntry: 'Restore Entry',
    btnDeletePermanently: 'Delete Permanently',
    
    // Toasts
    toastEnterPassword: 'Please enter your password.',
    toastVaultNotFound: 'No vault found. Please create a new vault.',
    toastWrongPasswordOrCorrupted: 'Wrong vault password or vault is corrupted.',
    toastMin8Chars: 'Master password must be at least 8 characters.',
    toastPasswordsDoNotMatch: 'Passwords do not match!',
    toastNoRecoveryFound: 'No recovery key found in the system.',
    toastPasswordRestored: 'Password restored successfully. You can now sign in.',
    toastInvalidRecoveryKey: 'Invalid Recovery Key!',
    toastGenericError: 'An error occurred.',
    toastVaultCreateFailed: 'Could not create vault: ',
    toastRecoveryKeyCopied: 'Key copied!',
    toastJsonExported: 'JSON backup saved.',
    toastCsvExported: 'CSV backup saved to the selected folder.',
    toastCopiedClipboard30s: ' copied to clipboard. Will be cleared in 30 seconds for security.',
    toastCopiedClipboard45s: 'Password copied to clipboard. Will be cleared in 45 seconds for security.',
    toastSiteRequired: 'Site and Password fields are required.',
    
    // Biometric
    bioPromptLogin: 'Unlock your Fuin vault',
    bioFallbackLabel: 'Use Password',
    bioEnablePrompt: 'Confirm to enable biometric login',
    bioEnabledSuccess: 'Biometric login enabled.',
    bioNotSupportedOrEnrolled: 'No biometric authentication available or not configured on your device.',
    bioSectionTitle: 'BIOMETRIC LOGIN',
    bioFingerprintFaceId: 'Fingerprint / FaceID',
    bioNoPasswordSub: 'Sign in without entering a password',
    
    // Navigation / Tabs
    tabVault: 'Vault',
    tabQrSync: 'QR Sync',
    tabTools: 'Tools',
    tabSettings: 'Settings',
    navVault: 'VAULT',
    navTools: 'TOOLS',
    navSettings: 'SETTINGS',
    
    // Categories
    cat_all: 'All',
    cat_fav: 'Favorites',
    cat_trash: 'Trash',
    cat_social: 'Social',
    cat_work: 'Work',
    cat_shopping: 'Shopping',
    cat_finance: 'Finance',
    cat_education: 'Education',
    cat_other: 'Other',
    
    // Vault Screen
    searchPlaceholderVault: 'Search passwords, usernames, or categories...',
    emptyCategoryResults: 'No passwords found in this category.',
    fieldUser: 'Username',
    fieldPassword: 'Password',
    
    // Tools
    ioTitle: 'EXPORT / IMPORT (JSON & CSV)',
    ioExportJsonBtn: '↑ Download JSON',
    ioExportCsvBtn: '↑ Download CSV',
    ioImportJsonBtn: '↓ Choose JSON',
    ioImportCsvBtn: '↓ Choose CSV',
    ioExportJsonTitle: 'Save JSON Backup',
    ioExportCsvTitle: 'Save CSV Backup',
    ioExportJsonFailed: 'JSON export failed: ',
    ioExportCsvFailed: 'CSV export failed: ',
    ioImportFailed: 'Import failed: ',
    ioItemsImportedSuccess: ' items imported successfully.',
    ioItemsImportedCsvSuccess: ' items imported and added successfully.',
    ioInvalidJsonError: 'Invalid Fuin or Bitwarden JSON file.',
    ioInvalidCsvEmpty: 'Invalid or empty CSV',
    ioInvalidCsvColumns: 'Invalid CSV format. Name/Site and Password columns not found.',
    secToolsTitle: 'SECURITY TOOLS',
    healthReportCardTitle: '◎ Health Report (HIBP Breach Scan)',
    healthReportCardSub: 'Scan your passwords against known data breaches using secure k-Anonymity.',
    backupsCardTitle: '◎ System Backups (Restore)',
    backupsCardSub: 'Revert to a previous AES-256-GCM encrypted vault snapshot.',
    
    // Settings
    themeTitle: 'THEME',
    themeSystem: 'SYSTEM',
    themeDark: 'DARK',
    themeLight: 'LIGHT',
    langTitle: 'LANGUAGE',
    autoLockTitle: 'BACKGROUND LOCK TIMEOUT',
    time1m: '1 min',
    time2m: '2 min',
    time5m: '5 min',
    timeNever: 'Never',
    autoLockSavedMsg: 'Lock timeout set to {label}.',
    sysSecurityTitle: 'SYSTEM & SECURITY',
    sysLocalVaultActive: 'Local Secure Vault active',
    sysCryptoArchitecture: 'Cryptographic Architecture',
    sysCryptoDetails: '• KDF: PBKDF2 (Desktop supports Argon2id)\n• Encryption: AES-256-GCM (Authenticated encryption)\n• Keys: VaultKey + SyncKey (Air-Gap Sync)\n• Sensitive data is decrypted only in memory (RAM).',
    lockSessionBtn: 'Log Out (Lock)',
    
    // Backup Modal
    backupModalTitle: 'SYSTEM BACKUPS',
    backupModalDesc: 'Every time you add or delete a password, your device automatically creates an encrypted (AES) backup. Select any backup to restore your vault to that point in time.',
    backupEmpty: 'No backups created yet.',
    dateToday: 'Today ',
    alertRestoreBody: ' backup will be restored. All your current data will be reverted and any recent changes (if any) will be lost. Do you confirm?',
    
    // Health Modal
    healthTitle: 'HEALTH REPORT',
    healthKAnonymityTitle: 'k-Anonymity Technology',
    healthInfoBox: 'Your passwords are never sent over the internet. Only the first 5 characters of the SHA-1 hash are queried. Matching happens entirely on your device.',
    healthScanBtn: 'START BREACH SCAN',
    healthScanning: 'Scanning...',
    healthScanAgain: 'SCAN AGAIN',
    hibpBreachedWarning: ' PASSWORDS BREACHED!',
    hibpBreachedCount: '× breached',
    hibpCleanCongrats: 'CONGRATULATIONS!',
    hibpAllClean: 'None of your passwords were found in known data breaches.',
    hibpNetworkError: ' passwords could not be checked (network error)',
    hibpCleanCount: ' passwords are safe',
    hibpUnknown: 'Unknown',
    
    // Edit Modal
    modalNewEntry: 'NEW ENTRY',
    modalEditEntry: 'EDIT ENTRY',
    modalDeletedEntry: 'DELETED ENTRY',
    fieldSite: 'PLATFORM / SITE NAME *',
    fieldSitePh: 'Netflix, Google, etc.',
    fieldCategory: 'CATEGORY',
    toggleFavLabel: 'FAVORITE',
    fieldUserLabel: 'USERNAME / EMAIL',
    fieldPasswordLabel: 'PASSWORD',
    genPwTitle: 'Generate',
    fieldUrl: 'WEBSITE URL',
    section2FA: '2FA (TWO-FACTOR AUTH)',
    toggle2FASub: 'TOTP SECRET KEY',
    fieldNote: 'NOTES',
    selectCategoryTitle: 'Select Category',
    
    // Generator Modal
    genTitle: 'PASSWORD GENERATOR',
    genApply: 'Apply',
    genCancel: 'Cancel',
    strengthLabel: 'Strength: ',
    strengthWeak: 'Weak',
    strengthMedium: 'Medium',
    strengthStrong: 'Strong',
    genLength: 'Character Length:',
    genUpper: 'A-Z (Uppercase)',
    genLower: 'a-z (Lowercase)',
    genNum: '0-9 (Numbers)',
    genSym: '!@# (Symbols)',
    genExc: 'Exclude Similar',
    
    // Sync / Camera
    syncTitle: 'AIR-GAP SYNC',
    syncEncrypting: 'Encrypting Vault...',
    syncChunksCollected: 'Collected Chunks: ',
    cameraPermissionRequired: 'Camera permission required.',
    alertSyncNeedPassword: 'Please enter your Master Password (SyncKey) before starting sync.',
    syncPasswordPromptTitle: 'Please enter the Sync Password set on your Desktop.',
    syncPasswordPh: 'Sync Password',
    syncPassMinLen: 'Sync password must be at least 10 characters.',
    syncRetryDelayText: 'Please wait before trying again:',
    syncRetryDelayPrefix: 'Security delay:',
    syncMasterPromptTitleExisting: 'Enter Master Password',
    syncMasterPromptTitleNew: 'Set a Master Password',
    syncMasterPromptDescExisting: 'Enter your Master Password to encrypt the imported vault on your device.',
    syncMasterPromptDescNew: 'Set a Master Password (at least 8 characters) to secure your imported vault.',
    syncMasterPasswordPh: 'Master Password (min 8 characters)',
    syncMasterConfirmPh: 'Confirm Master Password',
    syncImportBtn: 'Import Vault',
    syncTransferFailed: 'QR transfer failed. Please try again.',
    
    // Success Screen
    syncSuccessTitle: 'SYNC SUCCESSFUL',
    syncSuccessSubtitle: 'Vault encrypted and saved to your device.',
    
    // Recovery
    recoveryCreatedTitle: 'Vault Created!',
    recoveryCreatedBody: 'Save this recovery key in a safe place. If you forget your password, you can unlock the vault with this key.',
  }
};

const I18nContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('tr');
  
  useEffect(() => {
    SecureStore.getItemAsync('fuin-language').then(saved => {
      if (saved === 'en' || saved === 'tr') setLangState(saved);
    });
  }, []);
  
  const setLang = async (newLang) => {
    setLangState(newLang);
    await SecureStore.setItemAsync('fuin-language', newLang);
  };
  
  const t = (key) => TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.tr[key] ?? key;
  
  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
