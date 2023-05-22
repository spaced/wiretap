import {customElement, state, query} from "lit/decorators.js";
import {html, LitElement} from "lit";
import {Store} from "@/ranch/store";
import {BuildLiveTransactionFromState, HttpTransaction} from '@/model/http_transaction';
import {HttpTransactionItemComponent} from "./transaction-item.component";
import localforage from "localforage";
import {WiretapCurrentSpec, WiretapLocalStorage} from "@/wiretap";
import transactionContainerComponentCss from "./transaction-container.component.css";
import {HttpTransactionViewComponent} from "./transaction-view.component";
import {SpecEditor} from "@/components/editor/editor.component";
import {ViolationLocation} from "@/model/events";

@customElement('http-transaction-container')
export class HttpTransactionContainerComponent extends LitElement {

    static styles = transactionContainerComponentCss;

    private _allTransactionStore: Store<HttpTransaction>;
    private _selectedTransactionStore: Store<HttpTransaction>;
    private _specStore: Store<String>;
    private _transactionComponents: HttpTransactionItemComponent[] = [];

    @state()
    private _mappedHttpTransactions: Map<string, HttpTransactionContainer>

    @state()
    private _selectedTransaction: HttpTransaction

    @query('http-transaction-view')
    private _transactionView: HttpTransactionViewComponent

    @query('spec-editor')
    private _specEditor: SpecEditor;

    constructor(allTransactionStore: Store<HttpTransaction>,
                selectedTransactionStore: Store<HttpTransaction>,
                specStore: Store<String>) {
        super()
        this._allTransactionStore = allTransactionStore
        this._selectedTransactionStore = selectedTransactionStore
        this._specStore = specStore;
        this._mappedHttpTransactions = new Map<string, HttpTransactionContainer>()
    }


    connectedCallback() {
        super.connectedCallback();

        // listen for changes to selected transaction.
        this._selectedTransactionStore.onAllChanges(this.handleSelectedTransactionChange.bind(this))
        this._specStore.subscribe(WiretapCurrentSpec, this.handleSpecChange.bind(this))


        this._allTransactionStore.onAllChanges(this.handleTransactionChange.bind(this))
        this._allTransactionStore.onPopulated((storeData: Map<string, HttpTransaction>) => {
            // rebuild our internal state
            const savedTransactions: Map<string, HttpTransactionContainer> = new Map<string, HttpTransactionContainer>()
            storeData.forEach((value: HttpTransaction, key: string) => {
                const container: HttpTransactionContainer = {
                    Transaction: BuildLiveTransactionFromState(value),
                    Listener: (update: HttpTransaction) => {
                        this.requestUpdate();
                    }
                }
                savedTransactions.set(key, container)
            });
            // save our internal state.
            this._mappedHttpTransactions = savedTransactions

            // extract state
            this._mappedHttpTransactions.forEach(
                (v: HttpTransactionContainer) => {
                    const comp = new HttpTransactionItemComponent(v.Transaction)
                    this._transactionComponents.push(comp)
                }
            );
        });
    }

    handleSelectedTransactionChange(key: string, transaction: HttpTransaction) {
        this._selectedTransaction = transaction;
        this._transactionView.httpTransaction = transaction;
    }

    handleSpecChange(key: string) {
        this._specEditor.setValue(key)
    }


    handleTransactionChange(key: string, value: HttpTransaction) {

        // if we already have this transaction, update it.
        if (this._mappedHttpTransactions.has(value.id)) {
            const existingTransaction = this._mappedHttpTransactions.get(value.id)
            existingTransaction.Listener(value)
            const component: HttpTransactionItemComponent =
                this._transactionComponents.find((v: HttpTransactionItemComponent) => {
                    return v.transactionId === value.id;
                });
            component.httpTransaction = BuildLiveTransactionFromState(value);
            component.requestUpdate()

        } else {

            // otherwise, add it.
            const container: HttpTransactionContainer = {
                Transaction: BuildLiveTransactionFromState(value),
                Listener: (trans: HttpTransaction) => {

                    // update db.
                    let exp = this._allTransactionStore.export()
                    localforage.setItem<Map<string, HttpTransaction>>
                    (WiretapLocalStorage, exp).then(
                        () => {
                            console.log('saved')
                            this._transactionView.requestUpdate();
                        }
                    ).catch(
                        (err) => {
                            console.error(err)
                        }
                    )
                }
            }
            this._mappedHttpTransactions.set(value.id, container)
            const comp: HttpTransactionItemComponent = new HttpTransactionItemComponent(value)
            this._transactionComponents.push(comp)
            this.requestUpdate();
        }
    }


    render() {
        const reversed = this._transactionComponents.sort(
            (a: HttpTransactionItemComponent, b: HttpTransactionItemComponent) => {
                return b.httpTransaction.timestamp - a.httpTransaction.timestamp
            });

        return html`
            <section class="split-panel-divider">
                <sl-split-panel vertical style="height: calc(100vh - 57px); --min: 150px; --max: calc(100% - 400px);"
                                position-in-pixels="300">
                    <sl-icon slot="divider" name="grip-vertical"></sl-icon>
                    <div slot="start" class="transactions-container"
                         @httpTransactionSelected="${this.updateSelectedTransactionState}">
                        ${reversed}
                    </div>
                    <div slot="end">
                        <sl-split-panel style="height: 100%;  --min: 300px; --max: calc(100% - 250px);" position="60">
                            <sl-icon slot="divider" name="grip-vertical"></sl-icon>
                            <div slot="start" class="transaction-view-container">
                                <http-transaction-view @violationLocationSelected="${this.locationSelected}"></http-transaction-view>
                            </div>
                            <div slot="end" class="transaction-view-container">
                                <spec-editor id="spec-editor">
                                </spec-editor>
                            </div>
                        </sl-split-panel>
                    </div>
                </sl-split-panel>
            </section>
        `
    }

    locationSelected(e: CustomEvent<ViolationLocation>) {
        console.log('SPIN THE WHHEEEEEEL', e.detail)
        const editorRef = this._specEditor.editor
        editorRef.setPosition({column: e.detail.column, lineNumber: e.detail.line});
        editorRef.revealLinesInCenter(e.detail.line, e.detail.line);
        editorRef.revealPositionInCenter({column: e.detail.column, lineNumber: e.detail.line})
        editorRef.focus();
    }

    updateSelectedTransactionState(d: CustomEvent<HttpTransaction>): void {
        this._transactionComponents.forEach((v: HttpTransactionItemComponent) => {
            if (v._httpTransaction.id !== d.detail.id) {
                if (v.active) {
                    v.disable();
                }
            }
        });
        // update the store.
        this._selectedTransactionStore.set(d.detail.id, d.detail);
    }

}

interface HttpTransactionContainer {
    Transaction: HttpTransaction
    Listener: (update: HttpTransaction) => void
}