import React, { memo, useCallback, useMemo } from '../../../../lib/teact/teact';

import type { ApiToken, ApiTransaction } from '../../../../api/types';

import { ANIMATED_STICKER_BIG_SIZE_PX, TINY_TRANSFER_MAX_AMOUNT, TON_TOKEN_SLUG } from '../../../../config';
import { getActions, withGlobal } from '../../../../global';
import { bigStrToHuman, getIsTxIdLocal } from '../../../../global/helpers';
import { selectCurrentAccountState, selectIsNewWallet } from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { formatHumanDay, getDayStartAt } from '../../../../util/dateFormat';
import { findLast } from '../../../../util/iteratees';
import { ANIMATED_STICKERS_PATHS } from '../../../ui/helpers/animatedAssets';
import { compareTransactions } from '../../../../api/common/helpers';

import { useDeviceScreen } from '../../../../hooks/useDeviceScreen';
import useInfiniteLoader from '../../../../hooks/useInfiniteLoader';
import useLang from '../../../../hooks/useLang';

import AnimatedIconWithPreview from '../../../ui/AnimatedIconWithPreview';
import Loading from '../../../ui/Loading';
import NewWalletGreeting from './NewWalletGreeting';
import Transaction from './Transaction';

import styles from './Activity.module.scss';

interface OwnProps {
  isActive?: boolean;
}

type StateProps = {
  currentAccountId: string;
  slug?: string;
  isLoading?: boolean;
  isNewWallet: boolean;
  areTinyTransfersHidden?: boolean;
  byTxId?: Record<string, ApiTransaction>;
  txIdsBySlug?: Record<string, string[]>;
  tokensBySlug?: Record<string, ApiToken>;
  apyValue: number;
  savedAddresses?: Record<string, string>;
};

interface TransactionDateGroup {
  datetime: number;
  transactions: ApiTransaction[];
}

const FURTHER_SLICE = 50;

function Activity({
  isActive,
  currentAccountId,
  isLoading,
  isNewWallet,
  slug,
  txIdsBySlug,
  byTxId,
  tokensBySlug,
  areTinyTransfersHidden,
  apyValue,
  savedAddresses,
}: OwnProps & StateProps) {
  const { fetchTokenTransactions, fetchAllTransactions, showTransactionInfo } = getActions();

  const lang = useLang();
  const { isLandscape } = useDeviceScreen();

  const transactions = useMemo(() => {
    let txIds: string[] | undefined;

    const bySlug = txIdsBySlug ?? {};

    if (byTxId) {
      if (slug) {
        txIds = bySlug[slug] ?? [];
      } else {
        const lastTonTxId = findLast(bySlug[TON_TOKEN_SLUG] ?? [], (txId) => !getIsTxIdLocal(txId));
        txIds = Object.values(bySlug).flat();
        if (lastTonTxId) {
          txIds = txIds.filter((txId) => byTxId[txId].timestamp >= byTxId[lastTonTxId].timestamp);
        }

        txIds.sort((a, b) => compareTransactions(byTxId[a], byTxId[b], false));
      }
    }

    if (!txIds) {
      return undefined;
    }

    const allTransactions = txIds
      .map((txId) => byTxId?.[txId])
      .filter((transaction) => {
        return Boolean(
          transaction?.slug
            && (!slug || transaction.slug === slug)
            && (!areTinyTransfersHidden
              || Math.abs(bigStrToHuman(transaction.amount, tokensBySlug![transaction.slug!].decimals))
                >= TINY_TRANSFER_MAX_AMOUNT),
        );
      }) as ApiTransaction[];

    if (!allTransactions.length) {
      return [];
    }

    let currentDateGroup: TransactionDateGroup = {
      datetime: getDayStartAt(allTransactions[0].timestamp),
      transactions: [],
    };
    const groupedTransactions: TransactionDateGroup[] = [currentDateGroup];

    allTransactions.forEach((transaction, index) => {
      currentDateGroup.transactions.push(transaction);
      const nextTransaction = allTransactions[index + 1];

      if (nextTransaction) {
        const nextTransactionDayStartsAt = getDayStartAt(nextTransaction.timestamp);
        if (currentDateGroup.datetime !== nextTransactionDayStartsAt) {
          currentDateGroup = {
            datetime: nextTransactionDayStartsAt,
            transactions: [],
          };

          groupedTransactions.push(currentDateGroup);
        }
      }
    });

    return groupedTransactions;
  }, [tokensBySlug, byTxId, areTinyTransfersHidden, slug, txIdsBySlug]);

  const loadMore = useCallback(() => {
    if (slug) {
      fetchTokenTransactions({ slug, limit: FURTHER_SLICE });
    } else {
      fetchAllTransactions({ limit: FURTHER_SLICE });
    }
  }, [slug, fetchTokenTransactions, fetchAllTransactions]);

  const handleTransactionClick = useCallback(
    (txId: string) => {
      showTransactionInfo({ txId });
    },
    [showTransactionInfo],
  );

  const lastElementRef = useInfiniteLoader({ isLoading, loadMore });

  if (!currentAccountId) {
    return undefined;
  }

  function renderTransactionGroups(transactionGroups: TransactionDateGroup[]) {
    return transactionGroups.map((group, groupIdx) => (
      <div className={styles.group}>
        <div className={styles.date}>{formatHumanDay(lang, group.datetime)}</div>
        {group.transactions.map((transaction) => {
          return (
            <Transaction
              key={transaction?.txId}
              transaction={transaction}
              token={transaction.slug ? tokensBySlug?.[transaction.slug] : undefined}
              apyValue={apyValue}
              savedAddresses={savedAddresses}
              onClick={handleTransactionClick}
            />
          );
        })}
        {groupIdx + 1 === transactionGroups.length && <div ref={lastElementRef} className={styles.loaderThreshold} />}
      </div>
    ));
  }

  if (transactions === undefined) {
    return (
      <div className={buildClassName(styles.emptyList, styles.emptyListLoading)}>
        <Loading />
      </div>
    );
  }

  if (isLandscape && isNewWallet) {
    return (
      <div className={styles.greeting}>
        <NewWalletGreeting isActive mode="emptyList" />
      </div>
    );
  }

  if (!transactions?.length) {
    return (
      <div className={styles.emptyList}>
        <AnimatedIconWithPreview
          play={isActive}
          tgsUrl={ANIMATED_STICKERS_PATHS.noData}
          previewUrl={ANIMATED_STICKERS_PATHS.noDataPreview}
          size={ANIMATED_STICKER_BIG_SIZE_PX}
          className={styles.sticker}
          noLoop={false}
          nonInteractive
        />
        <p className={styles.emptyListTitle}>{lang('No Activity')}</p>
      </div>
    );
  }

  return <div>{renderTransactionGroups(transactions)}</div>;
}

export default memo(
  withGlobal<OwnProps>((global, ownProps, detachWhenChanged): StateProps => {
    const { currentAccountId } = global;
    detachWhenChanged(currentAccountId);

    const accountState = selectCurrentAccountState(global);
    const isNewWallet = selectIsNewWallet(global);
    const slug = accountState?.currentTokenSlug;
    const { txIdsBySlug, byTxId, isLoading } = accountState?.transactions || {};
    return {
      currentAccountId: currentAccountId!,
      slug,
      isLoading,
      byTxId,
      isNewWallet,
      txIdsBySlug,
      tokensBySlug: global.tokenInfo?.bySlug,
      areTinyTransfersHidden: global.settings.areTinyTransfersHidden,
      apyValue: accountState?.poolState?.lastApy || 0,
      savedAddresses: accountState?.savedAddresses,
    };
  })(Activity),
);
