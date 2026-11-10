import type { ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { GuestOnly, OwnerOnly, RequireAuth, RequireNoStore, RequireStore } from '@/app/guards'
import { type ModuleDef, modules } from '@/app/modules'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { DesignSystemPage } from '@/features/design-system/DesignSystemPage'
import { AssistantPage } from '@/features/assistant/AssistantPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { StockChangePage } from '@/features/inventory/StockChangePage'
import { LandingPage } from '@/features/landing/LandingPage'
import { NewProductPage } from '@/features/products/NewProductPage'
import { ProductDetailPage } from '@/features/products/ProductDetailPage'
import { ProductsPage } from '@/features/products/ProductsPage'
import { DashboardPage } from '@/features/reports/DashboardPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { CheckoutPage } from '@/features/sales/CheckoutPage'
import { SaleDetailPage } from '@/features/sales/SaleDetailPage'
import { SalesPage } from '@/features/sales/SalesPage'
import { StoreSettingsPage } from '@/features/settings/StoreSettingsPage'
import { TeamPage } from '@/features/settings/TeamPage'
import { StoreSetupPage } from '@/features/stores/StoreSetupPage'
import { NotFoundPage, RouteErrorPage } from '@/features/system/NotFoundPage'
import { AppShell } from '@/layouts/AppShell'

/** The screen for every PRD module (all MVP modules are implemented). */
const implemented: Record<string, ReactNode> = {
  dashboard: <DashboardPage />,
  reports: <ReportsPage />,
  assistant: <AssistantPage />,
  products: <ProductsPage />,
  'products-new': <NewProductPage />,
  inventory: <InventoryPage />,
  'sales-new': <CheckoutPage />,
  sales: <SalesPage />,
  restock: <StockChangePage mode="restock" />,
  adjustments: <StockChangePage mode="adjust" />,
  'settings-store': <StoreSettingsPage />,
  'settings-team': <TeamPage />,
}

export const implementedModuleIds = Object.keys(implemented)

function moduleElement(m: ModuleDef): ReactNode {
  const page = implemented[m.id] ?? <NotFoundPage />
  return m.access === 'owner' ? <OwnerOnly>{page}</OwnerOnly> : page
}

/**
 * Route table mirrors PRD §6. Guards shape navigation only; the API enforces
 * session, store membership and role on every request.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <LandingPage /> },
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { element: <RequireNoStore />, children: [{ path: '/onboarding/store', element: <StoreSetupPage /> }] },
          {
            element: <RequireStore />,
            children: [
              {
                element: <AppShell />,
                children: [
                  ...modules.map((m) => ({ path: m.path, element: moduleElement(m) })),
                  { path: '/products/:id', element: <ProductDetailPage /> },
                  { path: '/sales/:id', element: <SaleDetailPage /> },
                ],
              },
            ],
          },
        ],
      },
      ...(import.meta.env.DEV ? [{ path: '/design-system', element: <DesignSystemPage /> }] : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
