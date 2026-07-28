// src/components/ScreenVersions.jsx
// Pantalla de control de versiones (solo para Dirección e Ingeniería)

import { useState, useEffect } from 'react';
import supabase from '../supabase';
import { APP_VERSION } from '../lib/version';
import { BG, CARD, BD, T1, T2, T3, fnt } from '../lib/constants';

export default function ScreenVersions({ user, onBack }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Cargar versiones desde la BD
  async function loadVersions() {
    try {
      const { data, error } = await supabase
        .from('user_versions')
        .select('*')
        .order('version', { ascending: true }) // Desactualizados primero
        .order('last_seen', { ascending: false }); // Luego por actividad reciente

      if (error) {
        console.error('[ScreenVersions] Error al cargar versiones:', error);
        return;
      }

      setVersions(data || []);
    } catch (err) {
      console.error('[ScreenVersions] Error inesperado:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Cargar al montar
  useEffect(() => {
    loadVersions();
  }, []);

  // Suscripción Realtime para actualizaciones en vivo
  useEffect(() => {
    const channel = supabase
      .channel('user_versions_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_versions'
      }, (payload) => {
        console.log('[ScreenVersions] Realtime event:', payload);
        loadVersions(); // Recargar toda la lista cuando hay cambios
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Refresh manual
  function handleRefresh() {
    setRefreshing(true);
    loadVersions();
  }

  // Formatear última actividad
  function formatLastSeen(isoString) {
    if (!isoString) return '—';

    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    if (hours < 24) return `Hace ${hours} h`;
    return `Hace ${days} día${days > 1 ? 's' : ''}`;
  }

  // Calcular estadísticas
  const totalUsers = versions.length;
  const upToDate = versions.filter(v => v.version === APP_VERSION).length;
  const outdated = totalUsers - upToDate;
  const uniqueUsers = new Set(versions.map(v => v.user_id)).size;

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '16px', fontFamily: fnt }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px',
        padding: '12px',
        background: CARD,
        borderRadius: '12px',
        border: BD
      }}>
        <button onClick={onBack} style={{
          background: 'transparent',
          border: 'none',
          fontSize: '24px',
          cursor: 'pointer',
          padding: '4px 8px'
        }}>←</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: T1, fontWeight: 700 }}>
            📱 Control de Versiones
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: T3 }}>
            Versión actual del sistema: <strong>{APP_VERSION}</strong>
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={{
          background: '#2563EB',
          color: '#fff',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: refreshing ? 'not-allowed' : 'pointer',
          opacity: refreshing ? 0.6 : 1
        }}>
          🔄 {refreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Estadísticas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <StatCard label="Total dispositivos" value={totalUsers} color="#2563EB" />
        <StatCard label="Usuarios únicos" value={uniqueUsers} color="#059669" />
        <StatCard label="Actualizados" value={upToDate} color="#059669" />
        <StatCard label="Desactualizados" value={outdated} color={outdated > 0 ? '#DC2626' : '#6B7280'} />
      </div>

      {/* Lista de versiones */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: T3 }}>
          Cargando versiones...
        </div>
      ) : versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: T3 }}>
          No hay registros de versiones aún
        </div>
      ) : (
        <div style={{
          background: CARD,
          borderRadius: '12px',
          border: BD,
          overflow: 'hidden'
        }}>
          {/* Tabla header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 80px',
            gap: '12px',
            padding: '12px 16px',
            background: '#F1F5F9',
            borderBottom: BD,
            fontSize: '12px',
            fontWeight: 700,
            color: T2
          }}>
            <div>Usuario</div>
            <div>Dispositivo</div>
            <div>Versión</div>
            <div>Última actividad</div>
            <div style={{ textAlign: 'center' }}>Estado</div>
          </div>

          {/* Tabla body */}
          {versions.map((v, idx) => {
            const isUpToDate = v.version === APP_VERSION;
            return (
              <div key={`${v.user_id}-${v.device_type}`} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 80px',
                gap: '12px',
                padding: '14px 16px',
                borderBottom: idx < versions.length - 1 ? BD : 'none',
                fontSize: '13px',
                alignItems: 'center',
                background: isUpToDate ? 'transparent' : '#FEF2F2'
              }}>
                <div style={{ color: T1, fontWeight: 600 }}>
                  {v.user_name}
                </div>
                <div style={{ color: T2 }}>
                  {v.device_type === 'iOS' && '📱 iOS'}
                  {v.device_type === 'Android' && '📱 Android'}
                  {v.device_type === 'Desktop' && '💻 Desktop'}
                  {v.device_type === 'Other' && '❓ Otro'}
                </div>
                <div style={{
                  color: isUpToDate ? T2 : '#DC2626',
                  fontWeight: isUpToDate ? 400 : 700,
                  fontFamily: 'monospace',
                  fontSize: '12px'
                }}>
                  {v.version}
                </div>
                <div style={{ color: T3, fontSize: '12px' }}>
                  {formatLastSeen(v.last_seen)}
                </div>
                <div style={{ textAlign: 'center' }}>
                  {isUpToDate ? (
                    <span style={{
                      display: 'inline-block',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: '#059669',
                      color: '#fff',
                      fontSize: '14px',
                      lineHeight: '24px'
                    }}>✓</span>
                  ) : (
                    <span style={{
                      display: 'inline-block',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: '#DC2626',
                      color: '#fff',
                      fontSize: '14px',
                      lineHeight: '24px'
                    }}>!</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Componente de tarjeta de estadística
function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: CARD,
      border: BD,
      borderRadius: '12px',
      padding: '16px',
      textAlign: 'center'
    }}>
      <div style={{
        fontSize: '28px',
        fontWeight: 700,
        color,
        marginBottom: '4px'
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '12px',
        color: T3,
        fontWeight: 600
      }}>
        {label}
      </div>
    </div>
  );
}
