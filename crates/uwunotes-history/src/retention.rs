//! Which versions are still worth keeping.
//!
//! The rule people expect from a backup tool, applied per history: everything
//! from the last hour, the newest of each hour for the last day, the newest of
//! each day for as long as the user said, and never more than a fixed number
//! in all. The newest version is always kept, however old — a file nobody
//! touched for a year still has its last known state.
//!
//! Pure on purpose: a list of timestamps in, a list of verdicts out, the clock
//! a parameter. It is the one part of the crate worth testing exhaustively,
//! and it can be, without a disk.
//!
//! Buckets are counted in UTC. "The newest of each day" therefore breaks at
//! midnight UTC rather than local midnight, which moves *which* version of an
//! evening survives by an hour or two and changes nothing about how many do.

use std::collections::HashSet;

pub const HOUR_MS: i64 = 60 * 60 * 1_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

#[derive(Debug, Clone, Copy)]
pub struct Policy {
    /// Milliseconds since the epoch.
    pub now: i64,
    /// How many days daily versions are kept for. At least one.
    pub retention_days: u32,
    /// The hard ceiling per history, newest kept first. At least one.
    pub max_versions: usize,
}

/// One verdict per entry of `times`, in the same order: `true` keeps it.
///
/// `times` may be in any order. A timestamp in the future — a clock that was
/// wrong, then corrected — counts as "just now" rather than being thrown away
/// for being impossible.
pub fn keep(times: &[i64], policy: Policy) -> Vec<bool> {
    let mut verdicts = vec![false; times.len()];
    if times.is_empty() {
        return verdicts;
    }

    // Newest first, so the first version seen in a bucket is the one it keeps.
    let mut order: Vec<usize> = (0..times.len()).collect();
    order.sort_by(|&a, &b| times[b].cmp(&times[a]).then(b.cmp(&a)));

    let retention = i64::from(policy.retention_days.max(1)).saturating_mul(DAY_MS);
    let mut hours = HashSet::new();
    let mut days = HashSet::new();
    let mut kept = 0usize;
    let ceiling = policy.max_versions.max(1);

    for (rank, &index) in order.iter().enumerate() {
        let time = times[index];
        let age = policy.now.saturating_sub(time).max(0);
        let wanted = if rank == 0 || age < HOUR_MS {
            true
        } else if age < DAY_MS {
            hours.insert(time.div_euclid(HOUR_MS))
        } else if age < retention {
            days.insert(time.div_euclid(DAY_MS))
        } else {
            false
        };
        if wanted && kept < ceiling {
            verdicts[index] = true;
            kept += 1;
        }
    }
    verdicts
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_000 * DAY_MS;

    fn policy(retention_days: u32, max_versions: usize) -> Policy {
        Policy {
            now: NOW,
            retention_days,
            max_versions,
        }
    }

    fn kept(times: &[i64], policy: Policy) -> Vec<i64> {
        let verdicts = keep(times, policy);
        let mut out: Vec<i64> = times
            .iter()
            .zip(verdicts)
            .filter_map(|(time, keep)| keep.then_some(*time))
            .collect();
        out.sort_unstable();
        out
    }

    #[test]
    fn everything_from_the_last_hour_stays() {
        let times: Vec<i64> = (0..30).map(|minute| NOW - minute * 60_000).collect();
        assert_eq!(kept(&times, policy(30, 100)).len(), 30);
    }

    #[test]
    fn the_last_day_keeps_the_newest_of_each_hour() {
        // Four versions in each of the hours two to five hours ago.
        let mut times = Vec::new();
        for hour in 2..6 {
            for quarter in 0..4 {
                times.push(NOW - hour * HOUR_MS - quarter * 15 * 60_000);
            }
        }
        let survivors = kept(&times, policy(30, 100));
        let buckets: HashSet<i64> = survivors.iter().map(|t| t.div_euclid(HOUR_MS)).collect();
        assert_eq!(
            survivors.len(),
            buckets.len(),
            "two survivors share an hour"
        );
        // Every hour that had a version still has one.
        let all: HashSet<i64> = times.iter().map(|t| t.div_euclid(HOUR_MS)).collect();
        assert_eq!(buckets, all);
    }

    #[test]
    fn within_a_bucket_the_newest_wins() {
        let newer = NOW - 3 * DAY_MS + 5 * HOUR_MS;
        let older = NOW - 3 * DAY_MS + HOUR_MS;
        // A version from just now as well, so neither of the two is the newest
        // overall and both have to compete for their day.
        assert_eq!(
            kept(&[older, NOW, newer], policy(30, 100)),
            vec![newer, NOW]
        );
    }

    #[test]
    fn past_the_retention_only_the_newest_survives() {
        let ancient = [NOW - 90 * DAY_MS, NOW - 60 * DAY_MS, NOW - 45 * DAY_MS];
        assert_eq!(kept(&ancient, policy(30, 100)), vec![NOW - 45 * DAY_MS]);
    }

    #[test]
    fn the_ceiling_drops_the_oldest_first() {
        let times: Vec<i64> = (0..50).map(|minute| NOW - minute * 60_000).collect();
        let survivors = kept(&times, policy(30, 10));
        assert_eq!(survivors.len(), 10);
        assert_eq!(*survivors.first().unwrap(), NOW - 9 * 60_000);
    }

    #[test]
    fn a_future_timestamp_counts_as_now() {
        let times = [NOW + DAY_MS, NOW - 10 * 60_000];
        assert_eq!(kept(&times, policy(30, 100)).len(), 2);
    }

    #[test]
    fn nothing_in_nothing_out() {
        assert!(keep(&[], policy(30, 100)).is_empty());
    }
}
