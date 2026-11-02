import PowerDynamics from '@/components/PowerDynamics';
import styles from '../page.module.css';

export default function PowerDynamicsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <PowerDynamics />
      </main>
    </div>
  );
}
