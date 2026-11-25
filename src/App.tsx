import React, { useState, useEffect, useCallback } from 'react';
import { 
  Order, 
  InventoryItem, 
  Customer, 
  DefectItem, 
  PrintTask, 
  AppUser, 
  WarehouseBox,
  AuditLog,
  AuditActionType,
  SystemNotification
} from './types';
import { 
  INITIAL_ORDERS, 
  INITIAL_INVENTORY, 
  INITIAL_CUSTOMERS,
  INITIAL_DEFECTS,
  INITIAL_PRINT_TASKS,
  INITIAL_USERS,
  INITIAL_BOXES,
  INITIAL_AUDIT_LOGS
} from './mockData';

import { TRANSLATIONS, Language } from './locales';

// Views
import HomeView from './components/HomeView';
import OrdersView from './components/OrdersView';
import NakladnoyView, { NakladnoySectionId } from './components/NakladnoyView';
import WarehouseAuditModule from './warehouse-audit/components/WarehouseAuditModule';
import SettingsView from './components/SettingsView';
import LoginView from './components/LoginView';
import TexLogo from './components/TexLogo';
import NotificationCenter from './components/NotificationCenter';
import { checkCurrentSession, logoutUser, getAuthHeaders } from './lib/authClient';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  STORAGE_ROWS_KEY,
  STORAGE_MATRICES_KEY,
  TEX_ORDERS_UPDATED_EVENT,
  loadOrdersAndMatrices,
  ledgerRowsToAppOrders,
  notifyOrdersStoreUpdated
} from './lib/ordersSizeStore';
import {
  PackingListRow,
  createAndSaveWaybillFromRows
} from './lib/nakladnoyStore';

import {
  HOME_CONFIG_UPDATED_EVENT,
  HomeAnnouncementConfig,
  WEATHER_SETTING_STORAGE_KEY,
  WeatherSettingMode,
  loadHomeConfig,
  loadWeatherSetting,
  resolveActiveBackground,
  resolveAdaptiveWeather
} from './lib/homeStore';

// Icons
import { 
  Home,
  ShoppingBag, 
  Settings as SettingsIcon, 
  LogOut, 
  FileSpreadsheet,
  Menu,
  X,
  Snowflake,
  TreePine,
  ClipboardCheck
} from 'lucide-react';
import WeatherOverlay from './components/WeatherOverlay';

export default function App() {
  const [lang, setLang] = useState<Language>('ru');
  const t = TRANSLATIONS[lang];

  const [activeTab, setActiveTab] = useState<string>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  
  // Единый источник истины: данные из «Заказы → Размеры по заказу»
  const [ledgerRows, setLedgerRows] = useState<FactoryLedgerRow[]>(() => loadOrdersAndMatrices().rows);
  const [sizeMatrices, setSizeMatrices] = useState<Record<string, OrderSizeMatrix>>(() => loadOrdersAndMatrices().matrices);
  const [orders, setOrders] = useState<Order[]>(() => {
    const store = loadOrdersAndMatrices();
    return ledgerRowsToAppOrders(store.rows, store.matrices);
  });

  const handleSyncOrdersFromLedger = useCallback(
    (syncedOrders: Order[], rows: FactoryLedgerRow[], matrices: Record<string, OrderSizeMatrix>) => {
      setOrders(syncedOrders);
      setLedgerRows(rows);
      setSizeMatrices(matrices);
    },
    []
  );

  useEffect(() => {
    const refreshFromStore = () => {
      const store = loadOrdersAndMatrices();
      setLedgerRows(store.rows);
      setSizeMatrices(store.matrices);
      setOrders(ledgerRowsToAppOrders(store.rows, store.matrices));
    };
    window.addEventListener(TEX_ORDERS_UPDATED_EVENT, refreshFromStore);
    return () => window.removeEventListener(TEX_ORDERS_UPDATED_EVENT, refreshFromStore);
  }, []);

  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [defects, setDefects] = useState<DefectItem[]>(INITIAL_DEFECTS);
  const [printTasks, setPrintTasks] = useState<PrintTask[]>(INITIAL_PRINT_TASKS);
  const [users, setUsers] = useState<AppUser[]>(() => {
    const DEMO_USER_IDS = new Set(['usr-0', 'usr-1', 'usr-2', 'usr-3', 'usr-4', 'usr-5']);
    try {
      const saved = localStorage.getItem('chust_erp_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter((u: AppUser) => u && !DEMO_USER_IDS.has(u.id));
          const hasOwner = cleaned.some((u: AppUser) => u.id === 'usr-owner');
          const result = hasOwner ? cleaned : [INITIAL_USERS[0], ...cleaned];
          if (cleaned.length !== parsed.length || !hasOwner) {
            localStorage.setItem('chust_erp_users', JSON.stringify(result));
          }
          return result;
        }
      }
    } catch (e) {
      console.warn('Failed to load users from storage:', e);
    }
    return INITIAL_USERS;
  });

  const [boxes, setBoxes] = useState<WarehouseBox[]>(() => {
    try {
      const saved = localStorage.getItem('tex_erp_warehouse_boxes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load warehouse boxes from storage:', e);
    }
    return INITIAL_BOXES;
  });

  const handleUpdateBoxes = (updatedBoxes: WarehouseBox[]) => {
    setBoxes(updatedBoxes);
    try {
      localStorage.setItem('tex_erp_warehouse_boxes', JSON.stringify(updatedBoxes));
    } catch (e) {
      console.warn('Failed to save warehouse boxes:', e);
    }
  };

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  
  // Auth state: Strictly check session or remembered device via HttpOnly cookies and server verification
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function verifyBackendSession() {
      try {
        const res = await checkCurrentSession();
        if (isMounted) {
          if (res.authenticated && res.user) {
            setCurrentUser(res.user);
          } else {
            // Also check client cache if server is restarting or offline
            try {
              const sess = sessionStorage.getItem('chust_erp_session_user');
              const rem = localStorage.getItem('chust_erp_remembered_user');
              const userObj = sess ? JSON.parse(sess) : (rem ? JSON.parse(rem) : null);
              if (userObj && userObj.id) {
                setCurrentUser(userObj);
              } else {
                setCurrentUser(null);
              }
            } catch {
              setCurrentUser(null);
            }
          }
        }
      } catch (err) {
        console.warn('Session check failed:', err);
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    }
    verifyBackendSession();
    return () => { isMounted = false; };
  }, []);

  // Cross-tab order routing state
  const [selectedOrderForModal, setSelectedOrderForModal] = useState<Order | null>(null);

  // Weather & Scenery Ambiance state (strictly controlled from Settings; supports Auto by season & time of day)
  const [weatherSetting, setWeatherSetting] = useState<WeatherSettingMode>(() => loadWeatherSetting());
  const [homeConfig, setHomeConfig] = useState<HomeAnnouncementConfig>(() => loadHomeConfig());
  const [clockDate, setClockDate] = useState<Date>(() => new Date());

  const handleWeatherSettingChange = (effect: WeatherSettingMode) => {
    setWeatherSetting(effect);
    try {
      localStorage.setItem(WEATHER_SETTING_STORAGE_KEY, effect);
    } catch (e) {
      console.warn(e);
    }
  };

  useEffect(() => {
    const syncHomeConfig = () => setHomeConfig(loadHomeConfig());
    window.addEventListener(HOME_CONFIG_UPDATED_EVENT, syncHomeConfig);
    window.addEventListener('storage', syncHomeConfig);
    return () => {
      window.removeEventListener(HOME_CONFIG_UPDATED_EVENT, syncHomeConfig);
      window.removeEventListener('storage', syncHomeConfig);
    };
  }, []);

  // Notification Center & Toast states
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);

  const [toasts, setToasts] = useState<SystemNotification[]>([]);

  const addNotification = (
    title: string,
    message: string,
    type: 'info' | 'warning' | 'success' | 'alert' = 'info',
    statusTo?: string,
    orderId?: string
  ) => {
    const newNotif: SystemNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      message,
      type,
      createdAt: lang === 'ru' ? 'Только что' : 'Hozirgina',
      read: false,
      statusTo,
      orderId
    };

    setNotifications(prev => [newNotif, ...prev]);
    setToasts(prev => [newNotif, ...prev.slice(0, 2)]);

    // Auto-dismiss toast after 4.5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== newNotif.id));
    }, 4500);
  };

  // Live Clock State (updates every 1 second with date, weekday in active language, and seconds)
  useEffect(() => {
    const updateClock = () => setClockDate(new Date());
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentTimeStr = React.useMemo(() => {
    const dd = String(clockDate.getDate()).padStart(2, '0');
    const mm = String(clockDate.getMonth() + 1).padStart(2, '0');
    const yyyy = clockDate.getFullYear();
    const hh = String(clockDate.getHours()).padStart(2, '0');
    const min = String(clockDate.getMinutes()).padStart(2, '0');
    const ss = String(clockDate.getSeconds()).padStart(2, '0');
    const dayIdx = clockDate.getDay();
    const weekdaysUz = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    const weekdaysRu = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const dayName = lang === 'uz' ? weekdaysUz[dayIdx] : weekdaysRu[dayIdx];
    return `${dd}.${mm}.${yyyy} • ${dayName} • ${hh}:${min}:${ss}`;
  }, [clockDate, lang]);

  const activeBackground = resolveActiveBackground(homeConfig.bgTheme, clockDate);
  const weatherEffect = resolveAdaptiveWeather(weatherSetting, clockDate);

  // Helper to log audit transactions into auditLogs (Supabase audit_logs)
  const logAudit = (
    actionType: AuditActionType,
    department: string,
    entityName: string,
    entityId: string,
    description: string,
    oldData?: any,
    newData?: any
  ) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: currentTimeStr || new Date().toISOString().replace('T', ' ').slice(0, 16),
      userName: currentUser?.fullName || 'Tizim administratori',
      userRole: currentUser?.role,
      department,
      actionType,
      entityName,
      entityId,
      description,
      oldData: oldData ?? null,
      newData: newData ?? null
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  // Helper to strictly check tab permissions
  const VALID_TABS = new Set(['home', 'buyurtmalar', 'nakladnoy', 'ombor_tekshiruvi', 'settings']);
  const isTabAllowedForUser = (tabId: string, user: AppUser | null) => {
    if (!user) return false;
    if (!VALID_TABS.has(tabId)) return false;
    if (user.role === 'super_admin') return true;
    if (tabId === 'home' || tabId === 'ombor_tekshiruvi') return true;
    if (user.allowedTabs && user.allowedTabs.length > 0) {
      return user.allowedTabs.includes(tabId);
    }
    if (user.role === 'admin' && tabId !== 'settings') return true;
    return tabId === 'buyurtmalar' || tabId === 'nakladnoy' || tabId === 'ombor_tekshiruvi';
  };

  // Guard activeTab when currentUser changes or if an unallowed/removed tab is active
  useEffect(() => {
    if (currentUser && !isTabAllowedForUser(activeTab, currentUser)) {
      setActiveTab('home');
    }
  }, [currentUser, activeTab]);

  // 0-reset handler (без возврата старых демо-данных)
  const handleResetAllData = () => {
    setOrders([]);
    setLedgerRows([]);
    setSizeMatrices({});
    setInventory([]);
    setCustomers([]);
    setDefects([]);
    setPrintTasks([]);
    setBoxes([]);
    try {
      localStorage.removeItem('tex_erp_warehouse_boxes');
      localStorage.removeItem(STORAGE_ROWS_KEY);
      localStorage.removeItem(STORAGE_MATRICES_KEY);
      notifyOrdersStoreUpdated();
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
    setSelectedOrderForModal(null);
    logAudit('DELETE', 'Система', 'Все разделы', 'all', 'Barcha bo\'limlar 0 dan tozalandi', null, null);
  };

  const handleLoadDemoData = () => {
    setOrders([]);
    setLedgerRows([]);
    setSizeMatrices({});
    setInventory(INITIAL_INVENTORY);
    setCustomers(INITIAL_CUSTOMERS);
    setDefects(INITIAL_DEFECTS);
    setPrintTasks(INITIAL_PRINT_TASKS);
    setBoxes(INITIAL_BOXES);
    logAudit('UPDATE', 'Система', 'Заказы', 'clean', 'Демо-данные отключены: ввод только через Размеры по заказу', null, null);
  };

  // Handlers
  const handleAddOrder = (newOrder: Order) => {
    setOrders(prev => [newOrder, ...prev]);

    // Automatically update customer metrics
    setCustomers(prevCustomers => {
      return prevCustomers.map(cust => {
        if (cust.name.toLowerCase() === newOrder.customerName.toLowerCase()) {
          return {
            ...cust,
            totalOrders: cust.totalOrders + 1,
            totalSpent: cust.totalSpent + (newOrder.totalAmount || 0)
          };
        }
        return cust;
      });
    });

    // If order needs printing, automatically add to printing queue
    if (newOrder.printRequired) {
      const newPrintTask: PrintTask = {
        id: `prt-${Date.now()}`,
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        customerName: newOrder.customerName,
        productType: newOrder.productType,
        totalQuantity: newOrder.totalQuantity,
        printType: 'silk-screen',
        printDesignName: `Dizayn ${newOrder.orderNumber}`,
        inkColors: ['Standart'],
        status: 'kutilmoqda',
        assignedOperator: 'Akmal Turg\'unov',
        completedQty: 0,
        notes: newOrder.printDetails || ''
      };
      setPrintTasks(prev => [newPrintTask, ...prev]);
    }

    // Trigger Notification & Toast
    addNotification(
      lang === 'ru' ? "Новый Заказ Принят 📥" : "Yangi Buyurtma Qabul Qilindi 📥",
      lang === 'ru'
        ? `Заказ "${newOrder.brandName}" (${newOrder.totalQuantity.toLocaleString()} шт) успешно зарегистрирован.`
        : `"${newOrder.brandName}" buyurtmasi (${newOrder.totalQuantity.toLocaleString()} dona) muvaffaqiyatli ro'yxatga olindi.`,
      'info',
      newOrder.status,
      newOrder.id
    );

    logAudit(
      'CREATE', 
      'Заказы', 
      `Заказ ${newOrder.mosCode || newOrder.orderNumber}`, 
      newOrder.id, 
      lang === 'ru'
        ? `Создан новый заказ: ${newOrder.brandName} (${newOrder.totalQuantity.toLocaleString()} шт)`
        : `Yangi buyurtma yaratildi: ${newOrder.brandName} (${newOrder.totalQuantity.toLocaleString()} dona)`,
      null,
      newOrder
    );
  };

  const handleUpdateOrder = (updatedOrder: Order) => {
    const oldOrder = orders.find(o => o.id === updatedOrder.id);
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));

    // Status Change Tracking for Notification Center & Toasts
    const brand = updatedOrder.brandName || updatedOrder.modelCode || (lang === 'ru' ? 'Заказ' : 'Buyurtma');
    
    // Check if status changed to 'Tayyor' / 'yakunlandi'
    const isNowTayyor = 
      (updatedOrder.status === 'yakunlandi' && oldOrder?.status !== 'yakunlandi') ||
      (updatedOrder.shipmentPlanStatus === 'tayyor' && oldOrder?.shipmentPlanStatus !== 'tayyor') ||
      (updatedOrder.qtyPackaging >= updatedOrder.qtyOrder && updatedOrder.qtyOrder > 0 && (!oldOrder || oldOrder.qtyPackaging < oldOrder.qtyOrder));

    if (isNowTayyor) {
      addNotification(
        lang === 'ru' ? "Заказ Готов! 🎉" : "Buyurtma Tayyor Bo'ldi! 🎉",
        lang === 'ru'
          ? `Заказ "${brand}" готов на 100% и подготовлен к отгрузке.`
          : `"${brand}" buyurtmasi 100% tayyor holatga o'tdi va jo'natishga tayyorlandi.`,
        'success',
        'tayyor',
        updatedOrder.id
      );
    } else if (oldOrder && updatedOrder.status !== oldOrder.status) {
      const statusLabelsRu: Record<string, string> = {
        yangi: 'Новый',
        bichuv: 'Раскрой',
        tikuv: 'Пошив',
        qadoqlash: 'Упаковка',
        yakunlandi: 'Готов (Завершен)',
        bekor_qilindi: 'Отменен'
      };
      const statusLabelsUz: Record<string, string> = {
        yangi: 'Yangi',
        bichuv: 'Bichuv',
        tikuv: 'Tikuv',
        qadoqlash: 'Qadoqlash',
        yakunlandi: 'Tayyor (Yakunlandi)',
        bekor_qilindi: 'Bekor qilindi'
      };
      const stageName = lang === 'ru' ? (statusLabelsRu[updatedOrder.status] || updatedOrder.status) : (statusLabelsUz[updatedOrder.status] || updatedOrder.status);
      addNotification(
        lang === 'ru' ? `Статус изменен: ${stageName}` : `Holat o'zgardi: ${stageName}`,
        lang === 'ru' ? `"${brand}" переведен на этап "${stageName}".` : `"${brand}" buyurtmasi ${stageName} bosqichiga o'tkazildi.`,
        'info',
        updatedOrder.status,
        updatedOrder.id
      );
    } else if (oldOrder && updatedOrder.shipmentPlanStatus !== oldOrder.shipmentPlanStatus && updatedOrder.shipmentPlanStatus) {
      addNotification(
        lang === 'ru' ? `Статус отгрузки: ${updatedOrder.shipmentPlanStatus.toUpperCase()}` : `Otgruzka holati: ${updatedOrder.shipmentPlanStatus.toUpperCase()}`,
        lang === 'ru' ? `Обновлен статус плана отгрузки заказа "${brand}".` : `"${brand}" buyurtmasining jo'natish rejasi holati o'zgartirildi.`,
        'info',
        updatedOrder.shipmentPlanStatus,
        updatedOrder.id
      );
    }

    logAudit(
      'UPDATE',
      'Заказы',
      `Заказ ${updatedOrder.mosCode || updatedOrder.orderNumber}`,
      updatedOrder.id,
      updatedOrder.inShipmentPlan && !oldOrder?.inShipmentPlan
        ? `Otgruzka rejasiga qo'shildi (${updatedOrder.shipmentPlanStatus || 'rejalashtirilgan'})`
        : `Buyurtma ko'rsatkichlari yangilandi`,
      oldOrder ? { qtyCut: oldOrder.qtyCut, qtyPotok: oldOrder.qtyPotok, qtyPackaging: oldOrder.qtyPackaging, inShipmentPlan: oldOrder.inShipmentPlan } : null,
      { qtyCut: updatedOrder.qtyCut, qtyPotok: updatedOrder.qtyPotok, qtyPackaging: updatedOrder.qtyPackaging, inShipmentPlan: updatedOrder.inShipmentPlan, shipmentPlanStatus: updatedOrder.shipmentPlanStatus }
    );
  };

  const handleDeleteOrder = (id: string) => {
    const target = orders.find(o => o.id === id);
    setOrders(prev => prev.filter(o => o.id !== id));
    logAudit(
      'DELETE',
      'Заказы',
      `Заказ ${target?.mosCode || id}`,
      id,
      `Buyurtma tizimdan o'chirildi`,
      target,
      null
    );
  };

  const handleUpdateInventory = (updatedItems: InventoryItem[]) => {
    setInventory(updatedItems);
  };

  const handleAddCustomer = (newCustomer: Customer) => {
    setCustomers(prev => [...prev, newCustomer]);
  };

  const handleAddDefect = (newDefect: DefectItem) => {
    setDefects(prev => [newDefect, ...prev]);
    logAudit('CREATE', 'Брак', `Дефект ${newDefect.orderNumber}`, newDefect.id, `Brak qayd etildi (${newDefect.quantity} dona)`, null, newDefect);
  };

  const handleRemoveDefect = (id: string) => {
    const def = defects.find(d => d.id === id);
    setDefects(prev => prev.filter(d => d.id !== id));
    logAudit('DELETE', 'Брак', `Дефект ${def?.orderNumber || id}`, id, `Brak yozuvi o'chirildi`, def, null);
  };

  const [nakladnoyInitialSection, setNakladnoyInitialSection] = useState<NakladnoySectionId>('packing_list');
  const [nakladnoySectionNonce, setNakladnoySectionNonce] = useState<number>(0);

  const handleNavigateToNakladnoySection = (section: NakladnoySectionId) => {
    setNakladnoyInitialSection(section);
    setNakladnoySectionNonce(n => n + 1);
    setActiveTab('nakladnoy');
  };

  const handleGenerateNakladnoy = (selectedRows: PackingListRow[], shipmentNoHint: string) => {
    if (!selectedRows || selectedRows.length === 0) return;
    const creatorName = currentUser?.fullName || currentUser?.username;
    const wb = createAndSaveWaybillFromRows(selectedRows, shipmentNoHint, creatorName);

    addNotification(
      lang === 'ru' ? `Накладная № ${wb.waybillNo} сформирована` : `Nakladnoy № ${wb.waybillNo} yaratildi`,
      lang === 'ru'
        ? `Тара: ${wb.totalTara} · Кол-во: ${wb.totalQty.toLocaleString('ru-RU')} шт.`
        : `Tara: ${wb.totalTara} · Soni: ${wb.totalQty.toLocaleString('ru-RU')} dona.`,
      'success',
      'nakladnoy',
      wb.id
    );

    logAudit(
      'CREATE',
      'Накладная',
      `Накладная № ${wb.waybillNo}`,
      wb.id,
      lang === 'ru'
        ? `Сформирована накладная № ${wb.waybillNo} (${wb.totalTara} тар, ${wb.totalQty} шт)`
        : `Nakladnoy № ${wb.waybillNo} shakllantirildi (${wb.totalTara} tara, ${wb.totalQty} dona)`,
      null,
      { waybillNo: wb.waybillNo, totalTara: wb.totalTara, totalQty: wb.totalQty }
    );

    setNakladnoyInitialSection('waybill');
    setNakladnoySectionNonce(n => n + 1);
    setActiveTab('nakladnoy');
  };

  const handleAddPrintTask = (newTask: PrintTask) => {
    setPrintTasks(prev => [newTask, ...prev]);
  };

  const handleUpdatePrintTask = (updatedTask: PrintTask) => {
    setPrintTasks(prev => prev.map(pt => pt.id === updatedTask.id ? updatedTask : pt));
  };

  const handleAddUser = (newUser: AppUser) => {
    setUsers(prev => {
      const updated = [...prev, newUser];
      try {
        localStorage.setItem('chust_erp_users', JSON.stringify(updated));
      } catch (e) {
        console.warn('Storage error on user add:', e);
      }
      return updated;
    });
    logAudit('CREATE', 'Система', `Пользователь ${newUser.fullName}`, newUser.id, `Yangi xodim qo'shildi (${newUser.role})`, null, newUser);
  };

  const handleUpdateUser = (updatedUser: AppUser) => {
    const oldU = users.find(u => u.id === updatedUser.id);
    setUsers(prev => {
      const updated = prev.map(u => u.id === updatedUser.id ? updatedUser : u);
      try {
        localStorage.setItem('chust_erp_users', JSON.stringify(updated));
      } catch (e) {
        console.warn('Storage error on user update:', e);
      }
      return updated;
    });
    // Keep active session in sync if current user's profile or permissions changed
    if (currentUser?.id === updatedUser.id) {
      setCurrentUser(updatedUser);
      try {
        sessionStorage.setItem('chust_erp_session_user', JSON.stringify(updatedUser));
        if (localStorage.getItem('chust_erp_remembered_user')) {
          localStorage.setItem('chust_erp_remembered_user', JSON.stringify(updatedUser));
        }
      } catch {}
    }
    logAudit('UPDATE', 'Система', `Пользователь ${updatedUser.fullName}`, updatedUser.id, `Foydalanuvchi ma'lumotlari yangilandi`, oldU, updatedUser);
  };

  const handleDeleteUser = (id: string) => {
    const target = users.find(u => u.id === id);
    setUsers(prev => {
      const updated = prev.filter(u => u.id !== id);
      try {
        localStorage.setItem('chust_erp_users', JSON.stringify(updated));
      } catch (e) {
        console.warn('Storage error on user delete:', e);
      }
      return updated;
    });
    if (target) {
      logAudit('DELETE', 'Система', `Пользователь ${target.fullName}`, id, `Xodim tizimdan o'chirildi`, target, null);
    }
  };

  const handleDashboardOrderSelect = (order: Order) => {
    setSelectedOrderForModal(order);
    setActiveTab('buyurtmalar');
  };

  const handleSelectOrderById = (orderId: string) => {
    const target = orders.find(o => o.id === orderId);
    if (target) {
      setSelectedOrderForModal(target);
    }
    setActiveTab('buyurtmalar');
  };

  const handleSimulateStatusChange = () => {
    const target = orders[0];
    if (target) {
      handleUpdateOrder({
        ...target,
        status: 'yakunlandi',
        shipmentPlanStatus: 'tayyor',
        qtyPackaging: target.qtyOrder
      });
    } else {
      addNotification(
        lang === 'ru' ? "Заказ Готов к Отгрузке! 🎉" : "Buyurtma Tayyor Bo'ldi! 🎉",
        lang === 'ru'
          ? "Заказ LC Waikiki (Футболка Поло) готов на 100% и подготовлен к отгрузке."
          : "LC Waikiki (Polo futbolka) buyurtmasi 100% tayyor holatga o'tdi va jo'natishga tayyorlandi.",
        'success',
        'tayyor'
      );
    }
  };

  const handleLoginSuccess = (user: AppUser, rememberMe?: boolean) => {
    setCurrentUser(user);
    try {
      sessionStorage.setItem('chust_erp_session_user', JSON.stringify(user));
      if (rememberMe) {
        localStorage.setItem('chust_erp_remembered_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('chust_erp_remembered_user');
      }
    } catch (e) {
      console.warn('Storage error on login:', e);
    }

    logAudit('CREATE', 'Тизим', `Кириш: ${user.fullName}`, user.id, `Foydalanuvchi tizimga kirdi (${user.role})`, null, null);
    addNotification(
      lang === 'ru' ? `Добро пожаловать, ${user.fullName}!` : `Xush kelibsiz, ${user.fullName}!`,
      lang === 'ru' ? 'Вы успешно авторизовались в системе.' : 'Tizimga muvaffaqiyatli kirdingiz.',
      'success'
    );

    // Sync users to backend if administrator
    if (user.role === 'super_admin' || user.role === 'admin') {
      fetch('/api/auth/sync-users', {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ users }),
      }).catch(e => console.warn('User sync error:', e));
    }
  };

  const handleLogout = async () => {
    if (currentUser) {
      logAudit('DELETE', 'Тизим', `Чиқиш: ${currentUser.fullName}`, currentUser.id, `Foydalanuvchi tizimdan chiqdi`, null, null);
    }
    await logoutUser();
    setCurrentUser(null);
  };

  // While verifying cryptographic HttpOnly session cookie on load
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#030712] text-white flex flex-col items-center justify-center p-6 space-y-4">
        <TexLogo size="lg" variant="light" />
        <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 px-5 py-2.5 rounded-2xl text-cyan-400 font-mono text-xs shadow-xl">
          <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <span>XAVFSIZ SESSIYA TEKSHIRILMOQDA (256-BIT SSL)...</span>
        </div>
      </div>
    );
  }

  // If user is not authenticated, display login flow
  if (!currentUser) {
    return (
      <LoginView 
        users={users.filter(u => u.activeStatus)} 
        onLoginSuccess={handleLoginSuccess} 
        lang={lang} 
        onLanguageChange={setLang}
      />
    );
  }

  // Уникальное количество заказов (один заказ с 5 цветами считается как 1 заказ)
  const distinctOrdersCount = new Set(
    ledgerRows.map(r => (r.orderNo || '').trim().toUpperCase()).filter(Boolean)
  ).size;

  const allModules: Array<{
    id: string;
    label: string;
    fullLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'home', label: lang === 'uz' ? 'Bosh sahifa' : 'Главная', fullLabel: lang === 'uz' ? 'Bosh sahifa' : 'Главная', icon: Home },
    { id: 'buyurtmalar', label: lang === 'uz' ? 'Zakazlar' : 'Заказы', fullLabel: lang === 'uz' ? 'Zakazlar' : 'Заказы', icon: ShoppingBag, count: distinctOrdersCount },
    { id: 'nakladnoy', label: 'Накладная', fullLabel: 'Накладная', icon: FileSpreadsheet },
    { id: 'ombor_tekshiruvi', label: 'Ombor tekshiruvi', fullLabel: 'Ombor tekshiruvi', icon: ClipboardCheck },
    { id: 'settings', label: lang === 'uz' ? 'Sozlamalar' : 'Настройки', fullLabel: lang === 'uz' ? 'Sozlamalar' : 'Настройки', icon: SettingsIcon },
  ];

  const allowedModules = allModules.filter(m => isTabAllowedForUser(m.id, currentUser));
  const activeModuleObj = allModules.find(m => m.id === activeTab) || allModules[0];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans antialiased text-gray-100 relative overflow-x-hidden" id="erp-root-layout">
      {/* Global System-Wide Nature Landscape Background (Seasons & Time of Day) */}
      <div className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <img
          key={activeBackground.id}
          src={activeBackground.imageUrl}
          alt={lang === 'uz' ? activeBackground.nameUz : activeBackground.nameRu}
          className="w-full h-full object-cover object-center transition-opacity duration-1000"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/75 via-slate-950/65 to-slate-950/90" />
      </div>

      {/* Global Weather & Holiday Visual Overlay */}
      <WeatherOverlay effect={weatherEffect} />
      
      {/* 1. TOP HEADER BRAND & HORIZONTAL NAVIGATION (Moved from left sidebar to top) */}
      <header className="bg-slate-900/80 text-white border-b border-white/10 sticky top-0 z-30 shadow-md backdrop-blur-md" id="erp-header">
        <div className="max-w-full mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          
          {/* Brand & Mobile Title */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Barcha bo'limlar menyusi"
            >
              <Menu className="w-5 h-5 text-cyan-400" />
            </button>

            <TexLogo size="sm" variant="light" showSubtitle={false} festive={weatherEffect === 'new_year' || weatherEffect === 'snow' || weatherEffect === 'holidays'} />

            {(weatherEffect === 'new_year' || weatherEffect === 'holidays') && (
              <span className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-950/90 via-red-950/70 to-amber-950/90 border border-amber-400/40 text-amber-200 text-[10px] font-bold shadow-xs whitespace-nowrap shrink-0">
                <TreePine className="w-3 h-3 text-emerald-400" />
                <span>{lang === 'uz' ? 'Yangi Yil bilan!' : 'С Новым Годом!'}</span>
                <Snowflake className="w-3 h-3 text-sky-300 animate-spin" style={{ animationDuration: '8s' }} />
              </span>
            )}
          </div>

          {/* Center Horizontal Desktop Navigation (formerly aside#sidebar-navigation) */}
          <nav
            id="top-navigation"
            aria-label="Primary navigation"
            className="hidden lg:flex items-center gap-1 bg-slate-950/75 border border-white/10 rounded-xl p-1 shadow-inner overflow-x-auto no-scrollbar"
          >
            {allowedModules.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id !== 'buyurtmalar') setSelectedOrderForModal(null);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50 shadow-xs font-bold'
                      : 'bg-transparent text-slate-300 border-transparent hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-300' : 'text-slate-400'}`} />
                  <span>{tab.fullLabel}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="text-[10px] font-mono tabular-nums font-bold px-1.5 py-0.2 rounded-full bg-cyan-900/90 text-cyan-200 border border-cyan-700">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Controls (Clock + Language + Notifications + User + Logout) */}
          <div className="flex items-center space-x-1.5 sm:space-x-2.5 text-xs shrink-0">
            {/* Compact Live Clock Pill */}
            <div className="hidden md:flex items-center gap-1.5 bg-slate-950/80 border border-white/10 text-slate-300 font-mono tabular-nums text-[11px] py-1.5 px-2.5 rounded-xl shadow-xs whitespace-nowrap shrink-0">
              <span className="text-slate-400">{lang === 'uz' ? 'Vaqt:' : 'Время:'}</span>
              <span className="text-cyan-400 font-bold">{currentTimeStr}</span>
            </div>

            {/* Global Language Toggle (RU / UZB) */}
            <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl p-0.5 text-xs font-bold shadow-xs shrink-0">
              <button
                type="button"
                onClick={() => setLang('ru')}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer text-[11px] font-black whitespace-nowrap shrink-0 ${
                  lang === 'ru' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="Русский язык"
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLang('uz')}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer text-[11px] font-black whitespace-nowrap shrink-0 ${
                  lang === 'uz' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="O'zbek tili (Lotin)"
              >
                UZB
              </button>
            </div>

            {/* Notification Center */}
            <NotificationCenter 
              notifications={notifications}
              toasts={toasts}
              onDismissToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
              onMarkAllAsRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
              onMarkAsRead={(id) => setNotifications(prev => prev.map(n => n.id === id ? ({ ...n, read: true }) : n))}
              onClearAll={() => { setNotifications([]); setToasts([]); }}
              onSelectOrder={handleSelectOrderById}
              lang={lang}
              onSimulateStatusChange={handleSimulateStatusChange}
            />

            {/* Current user badge (hidden on tiny screens) */}
            <div className="hidden xl:flex items-center space-x-1.5 bg-slate-800/80 px-2.5 py-1 rounded-xl border border-slate-700/60 whitespace-nowrap shrink-0">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-slate-200 font-semibold text-xs">{currentUser.fullName.split(' ')[0]}</span>
              <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-1.5 py-0.2 rounded-md font-mono">
                {currentUser.role}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-rose-500/20 shrink-0"
              title={t.logout}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>
        {/* Festive New Year Garland Lights along bottom of header */}
        {(weatherEffect === 'new_year' || weatherEffect === 'holidays') && (
          <div className="h-1.5 w-full overflow-hidden flex items-center justify-around bg-slate-950/60 border-t border-slate-800/70 pointer-events-none">
            {Array.from({ length: 36 }).map((_, idx) => {
              const bulbColors = [
                'bg-rose-400 shadow-[0_0_6px_#fb7185]',
                'bg-amber-300 shadow-[0_0_6px_#fcd34d]',
                'bg-emerald-400 shadow-[0_0_6px_#34d399]',
                'bg-sky-400 shadow-[0_0_6px_#38bdf8]'
              ];
              return (
                <span
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full ${bulbColors[idx % bulbColors.length]} animate-pulse`}
                  style={{ animationDelay: `${(idx % 4) * 0.35}s`, animationDuration: '1.8s' }}
                />
              );
            })}
          </div>
        )}
      </header>

      {/* 2. MAIN WORKSPACE CONTAINER (Full-width horizontal layout) */}
      <div className="relative z-10 flex-1 max-w-full w-full mx-auto px-2.5 sm:px-6 py-3 sm:py-5 flex flex-col gap-5 pb-24 lg:pb-8" id="workspace-grid">

        {/* WORKSPACE ACTIVE VIEW */}
        <main className="w-full min-w-0 flex flex-col space-y-4" id="main-content-display">
          {activeTab === 'home' && (
            <HomeView
              lang={lang}
              currentUser={currentUser}
              distinctOrdersCount={distinctOrdersCount}
              canAccessSettings={isTabAllowedForUser('settings', currentUser)}
              onNavigateToTab={setActiveTab}
            />
          )}

          {activeTab === 'buyurtmalar' && (
            <OrdersView
              orders={orders}
              customers={customers}
              boxes={boxes}
              onUpdateBoxes={handleUpdateBoxes}
              onAddOrder={handleAddOrder}
              onUpdateOrder={handleUpdateOrder}
              onDeleteOrder={handleDeleteOrder}
              onSyncOrdersFromLedger={handleSyncOrdersFromLedger}
              selectedOrderFromDashboard={selectedOrderForModal}
              onClearSelectedOrder={() => setSelectedOrderForModal(null)}
              currentUser={currentUser}
              lang={lang}
              onNavigateToTab={setActiveTab}
            />
          )}

          {activeTab === 'nakladnoy' && (
            <NakladnoyView
              ledgerRows={ledgerRows}
              sizeMatrices={sizeMatrices}
              currentUserName={currentUser.fullName || currentUser.username}
              initialSection={nakladnoyInitialSection}
              sectionNonce={nakladnoySectionNonce}
            />
          )}

          {activeTab === 'ombor_tekshiruvi' && (
            <WarehouseAuditModule />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              lang={lang}
              onChangeLanguage={setLang}
              weatherEffect={weatherSetting}
              onWeatherEffectChange={handleWeatherSettingChange}
              langList={['uz', 'ru']}
              onResetAllData={handleResetAllData}
              onLoadDemoData={handleLoadDemoData}
              users={users}
              onAddUser={handleAddUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              currentUser={currentUser}
              orders={orders}
              inventory={inventory}
              customers={customers}
              defects={defects}
              printTasks={printTasks}
              boxes={boxes}
              auditLogs={auditLogs}
            />
          )}
        </main>
      </div>

      {/* FOOTER (hidden on mobile to save viewport space) */}
      <footer className="relative z-10 hidden sm:block bg-slate-900/75 backdrop-blur-md border-t border-white/10 py-6 mt-12 text-center text-xs text-slate-300" id="erp-footer">
        <div className="max-w-7xl mx-auto px-4 flex flex-col items-center justify-center space-y-2">
          <TexLogo size="sm" variant="light" showSubtitle={false} />
          <p className="text-[11px] text-slate-500">
            © 2026 Shogirt ERP. {lang === 'uz' ? "Ishlab chiqarish boshqaruv tizimi." : "Система управления производством."}
          </p>
        </div>
      </footer>

      {/* 3. MOBILE FIXED BOTTOM NAVIGATION BAR */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 border-t border-slate-800 backdrop-blur-md px-1 py-1.5 flex items-center justify-around shadow-2xl safe-area-bottom" id="mobile-bottom-nav">
        {allowedModules.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={`mob-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id !== 'buyurtmalar') setSelectedOrderForModal(null);
              }}
              className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl transition-all relative cursor-pointer ${
                isActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute -top-1 -right-2 bg-cyan-500 text-slate-950 text-[9px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 truncate max-w-[78px]">{tab.label}</span>
            </button>
          );
        })}

        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer ${
            isMobileMenuOpen ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Menu className="w-5 h-5 text-slate-400" />
          <span className="text-[10px] mt-0.5 truncate">{lang === 'uz' ? 'Menyu' : 'Меню'}</span>
        </button>
      </nav>

      {/* 4. MOBILE FULL-DRAWER MODAL */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col justify-end animate-in fade-in duration-150">
          <div className="bg-slate-900 border-t border-slate-800 rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TexLogo size="sm" variant="light" showSubtitle={false} />
                <span className="text-xs font-bold text-slate-300">
                  {lang === 'uz' ? "Barcha bo'limlar" : 'Все разделы системы'}
                </span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-2 gap-2.5">
              {allowedModules.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={`drw-${tab.id}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIsMobileMenuOpen(false);
                      if (tab.id !== 'buyurtmalar') setSelectedOrderForModal(null);
                    }}
                    className={`p-3 rounded-2xl border flex items-center gap-3 text-left transition-all cursor-pointer ${
                      isActive
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 shadow-md'
                        : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className={`p-2 rounded-xl ${isActive ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-700 text-slate-300'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate">{tab.fullLabel}</p>
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className="text-[10px] text-cyan-400 font-mono font-bold">
                          {tab.count} {lang === 'uz' ? 'ta zakaz' : 'заказов'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-slate-300 font-medium truncate max-w-[140px]">{currentUser.fullName}</span>
              </div>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl font-bold flex items-center gap-1.5 hover:bg-rose-500/20 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.logout}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
