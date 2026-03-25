import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/Dashboard.vue'),
  },

  {
    path: '/agents',
    name: 'Agents',
    component: () => import('@/views/Agents.vue'),
  },
  {
    path: '/bots',
    name: 'Bots',
    component: () => import('@/views/Bots.vue'),
  },
  {
    path: '/office',
    name: 'Office',
    component: () => import('@/views/Office.vue'),
  },
  {
    path: '/llm',
    name: 'LLM',
    component: () => import('@/views/Models.vue'),
  },
  {
    path: '/knowledge',
    name: 'Knowledge',
    component: () => import('@/views/Knowledge.vue'),
  },

  {
    path: '/skills',
    name: 'Skills',
    component: () => import('@/views/Skills.vue'),
  },
  {
    path: '/mcp',
    name: 'MCP',
    component: () => import('@/views/MCP.vue'),
  },
  {
    path: '/files',
    name: 'Files',
    component: () => import('@/views/Files.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/Settings.vue'),
  },
];

const router = createRouter({
  history: window.location.protocol === 'file:' ? createWebHashHistory() : createWebHistory(),
  routes,
});

export default router;
